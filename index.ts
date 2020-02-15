import * as http from 'http';
import { URL, PathPattern } from 'tools-box/url';
import { CODES } from 'tools-box/fetch/codes';
import { connect, Client, Subscription } from 'ts-nats';
import fetch from 'tools-box/fetch';
import { Validall } from 'validall';
import * as SocketIO from 'socket.io';
import * as Net from "net";
import { ISchema } from 'validall/schema';
import { Payload, NatsConnectionOptions, SubscriptionOptions } from 'ts-nats';
import * as cluster from 'cluster';
import { WorkerMessage, WorkersManager } from './workers';
import { LOGLEVEL, Logger } from './logger';

/**
 * Service Interface
 */
interface Service {
  log: (mode: LOGLEVEL, msg: any, meta: any) => void;
  [key: string]: any;
}

/**
 * Globals:
 * nats server, httpServer, SocketIO Server and the user service instance
 */
// let nats: Client;
let server: Net.Server;
let service: Service;

/**
 * logger instance
 */
let logger = new Logger();

interface ProcessMsgsListeners {
  [key: string]: string;
}

const processMsgsListners: ProcessMsgsListeners = {};

export interface ValidatorDefualts {
  strict?: boolean;
  filter?: boolean;
  required?: boolean;
  nullable?: boolean;
}

const validatorDefualts: ValidatorDefualts = {
  strict: false,
  filter: false,
  required: false,
  nullable: false
}

export interface SocketIOOptions {
  serverOptions?: SocketIO.ServerOptions;
  maxListeners?: number;
}

export interface AuthOptions {
  endpoint?: string;
  subject?: string;
  timeout?: number;
}

/**
 * Service Decorator options
 */
export interface ServiceConfig {
  version?: number;
  port?: number;
  workers?: number;
  logLevel?: LOGLEVEL;
  validatorDefaults?: ValidatorDefualts;
  nats?: string | number | NatsConnectionOptions;
  exitOnUnhandledException?: boolean;
  socket?: SocketIOOptions;
  auth?: AuthOptions;
}

/**
 * Service Config Object
 */
let serviceConfig: ServiceConfig & { name: string };

export type HttpMehod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export interface IRedisOptions {
  host: string;
  port: number;
  pass?: string;
}

/**
 * Service Decorator
 * accepts all service config
 * @param config 
 */
export function SERVICE(config: ServiceConfig = {}) {
  return (constructor: any) => {
    serviceConfig = {
      name: constructor.name.toLowerCase(),
      version: config.version || 0,
      workers: config.workers || 0,
      logLevel: config.logLevel || LOGLEVEL.INFO,
      validatorDefaults: Object.assign(validatorDefualts, config.validatorDefaults || {}),
      exitOnUnhandledException: config.exitOnUnhandledException === undefined ? true : !!config.exitOnUnhandledException,
      port: config.port || 3888,
      nats: config.nats,
      socket: config.socket,
      auth: config.auth
    }
  }
}

export function MSG(processMsg: string) {
  return function (target: any, key: string) {
    processMsgsListners[processMsg] = key;
  }
}

/**
 * Route Config interface
 */
export interface RouteConfig {
  name?: string;
  path?: string;
  method?: HttpMehod;
  requestType?: string;
  body?: ISchema;
  bodyQuota?: number;
  query?: ISchema;
  queryLength?: number;
  auth?: boolean;
  timeout?: number;
}

interface RouteFullConfig extends RouteConfig {
  key?: string;
  bodyValidator?: Validall;
  queryValidator?: Validall
};

/**
 * Routes repo interface
 */
export interface Routes {
  GET?: { [key: string]: RouteFullConfig };
  POST?: { [key: string]: RouteFullConfig };
  PUT?: { [key: string]: RouteFullConfig };
  PATCH?: { [key: string]: RouteFullConfig };
  DELETE?: { [key: string]: RouteFullConfig };
  OPTIONS?: { [key: string]: RouteFullConfig };
}

/**
 * Routes repo object that will hold all defined routes
 */
let serviceRoutes: Routes = {};
let serviceRoutesRepo: (RouteConfig & { key: string })[] = [];

/**
 * route decorator
 * accepts route configuration
 * @param config 
 */
export function ROUTE(config: RouteConfig = {}) {
  return (target: any, key: string) => {
    serviceRoutesRepo.push({ key, ...config });
  }
}

/**
 * Nats Subject config interface
 */
export interface SubjectConfig {
  subject: string;
  body?: ISchema;
  bodyQuota?: number;
  payload?: Payload;
  options?: SubscriptionOptions;
  auth?: boolean;
}

interface SubjectFullConfig extends SubjectConfig {
  bodyValidator?: Validall;
}

/**
 * Nats subjects repo that will hold all defined subjects
 */
let serviceSubjects: { [key: string]: SubjectFullConfig } = {};

/**
 * Nats subject decorator
 * accepts subject configurations
 * @param config 
 */
export function SUBJECT(config: SubjectConfig) {
  return (target: any, key: string) => {
    serviceSubjects[key] = <SubjectFullConfig>{
      subject: config.subject,
      options: config.options || null,
      bodyValidator: config.body ? new Validall({ id: key, schema: config.body, ...validatorDefualts }) : null,
      bodyQuota: config.bodyQuota || 1024 * 100,
      payload: config.payload || Payload.JSON,
      auth: !!config.auth
    }
  };
}

/**
 * Socket IO namespace config interface
 */
export interface Namespace {
  connect?: string;
  reconnect?: string;
  handshake?: string;
  auth?: boolean;
  use?: string;
  useSocket?: string;
  events?: { [key: string]: string };
  disconnect?: string;
}

/**
 * Socket IO namespaces repo
 */
let serviceNamespaces: { [key: string]: Namespace } = {};

/**
 * Socket IO connect decorator
 * accepts list of namespaces names
 * @param namespaces 
 */
export function CONNECT(namespaces: string[] = ['default']) {
  return (target: any, key: string) => {
    for (let namespace of namespaces) {
      serviceNamespaces[namespace] = serviceNamespaces[namespace] || {};
      serviceNamespaces[namespace].connect = key;
    }
  }
}

/**
 * Socket IO reconnect decorator
 * accepts list of namespaces names
 * @param namespaces 
 */
export function RECONNECT(namespaces: string[] = ['default']) {
  return (target: any, key: string) => {
    for (let namespace of namespaces) {
      serviceNamespaces[namespace] = serviceNamespaces[namespace] || {};
      serviceNamespaces[namespace].reconnect = key;
    }
  }
}

/**
 * Socket IO handshake decorator
 * accepts list of namespaces names with auth boolean option
 * @param namespaces 
 */
export function HANDSHAKE(namespaces: string[] = ['default'], auth = false) {
  return (target: any, key: string) => {
    for (let namespace of namespaces) {
      serviceNamespaces[namespace] = serviceNamespaces[namespace] || {};
      serviceNamespaces[namespace].handshake = key;
      serviceNamespaces[namespace].auth = !!auth
    }
  }
}

/**
 * Socket IO use decorator
 * accepts list of namespaces names
 * @param namespaces 
 */
export function USE(namespaces: string[] = ['default']) {
  return (target: any, key: string) => {
    for (let namespace of namespaces) {
      serviceNamespaces[namespace] = serviceNamespaces[namespace] || {};
      serviceNamespaces[namespace].use = key;
    }
  }
}

/**
 * Socket IO usesocket decorator
 * accepts list of namespaces names
 * @param namespaces 
 */
export function USESOCLET(namespaces: string[] = ['default']) {
  return (target: any, key: string) => {
    for (let namespace of namespaces) {
      serviceNamespaces[namespace] = serviceNamespaces[namespace] || {};
      serviceNamespaces[namespace].useSocket = key;
    }
  }
}

/**
 * Socket IO event decorator
 * accepts event name and list of namespaces names
 * @param namespaces 
 */
export function EVENT(name?: string, namespaces: string[] = ["default"]) {
  return (target: any, key: string) => {
    for (let namespace of namespaces) {
      serviceNamespaces[namespace] = serviceNamespaces[namespace] || {};
      serviceNamespaces[namespace].events = serviceNamespaces[namespace].events || {};
      serviceNamespaces[namespace].events[name] = key;
    }
  }
}

/**
 * Socket IO disconnect decorator
 * accepts list of namespaces names
 * @param namespaces 
 */
export function DISCONNET(namespaces: string[] = ['default']) {
  return (target: any, key: string) => {
    for (let namespace of namespaces) {
      serviceNamespaces[namespace] = serviceNamespaces[namespace] || {};
      serviceNamespaces[namespace].disconnect = key;
    }
  }
}

/**
 * auhtorize method payload interface
 */
interface RequestPayload {
  params?: { [key: string]: string | number };
  query?: any;
  body?: any;
}

interface AuthPayload {
  service: string;
  name: string;
  payload: RequestPayload;
}

/**
 * Authorize user token
 * @param auth {string} user token
 * @param key {String}
 * @param payload {RequestPayload}
 * @returns {Any} User 
 */
async function authorize(auth: string, name: string, payload: RequestPayload): Promise<any> {
  if (!auth)
    return null;

  if (serviceConfig.auth.endpoint) {
    let res = await fetch({
      url: serviceConfig.auth.endpoint,
      headers: { Authorization: `basic ${auth}` },
      method: 'POST',
      timeout: serviceConfig.auth.timeout || 15000,
      data: <AuthPayload>{
        service: service.constructor.name,
        name,
        payload
      }
    });

    return res.data;
  } else if (serviceConfig.auth.subject && Micro.nats) {
    let res = await Micro.nats.request(serviceConfig.auth.subject, serviceConfig.auth.timeout || 15000, JSON.stringify({
      auth,
      service: service.constructor.name,
      name,
      payload
    }));

    return res.data;

  } else {
    logger.warn('auth options was not provided', name);
  }
}

/**
 * Finds the matched route method declared whtin the service
 * @param url {URL}
 * @param method {HttpMethod}
 */
function findRoute(url: URL, method: HttpMehod): { route: RouteFullConfig, params: { [key: string]: string } } {
  let routes = serviceRoutes;
  if (!routes || !routes[method])
    return null;

  for (let routePath in routes[method]) {
    let route = routes[method][routePath];
    let pathPattern = new PathPattern(route.path);
    if (pathPattern.match(url.pathname)) return { route, params: pathPattern.params };
  }

  return <any>{};
}

/**
 * Request wrapper for original node incoming message
 * include url and body parsing
 */
export class Request {
  url: URL;
  method: HttpMehod;
  params: { [key: string]: string };
  body: any;
  user?: any;
  auth?: string;

  constructor(public http: http.IncomingMessage) {
    this.url = new URL('http://' + this.http.headers.host + this.http.url);
    this.method = <HttpMehod>this.http.method.toUpperCase();
  }

  get(key: string) { return this.http.headers[key]; }
}

/**
 * Http request factory
 * @param socket 
 */
function createRequest(http: http.IncomingMessage): Promise<Request> {
  let request = new Request(http);

  return new Promise((res, rej) => {
    if (['post', 'put', 'patch', 'delete'].indexOf(request.method.toLowerCase()) > -1) {
      let payload: Uint8Array[] = [];
      request.http.on("data", data => {
        payload.push(data);
      }).on('end', () => {
        request.body = JSON.parse(Buffer.concat(payload).toString());
        res(request);
      }).on("error", err => {
        logger.error(err, { request });
        rej(err);
      });
    } else {
      res(request);
    }
  });
}

/**
 * Response wrapper over origin http.ServerResponse
 */
export class Response {
  private ended: boolean;

  constructor(private request: Request, public http: http.ServerResponse) {
  }

  end(cb?: () => void): void;
  end(chunck: any, cb?: () => void): void;
  end(chunck: any, encoding: string, cb?: () => void): void;
  end(chunck?: any | (() => void), encoding?: string | (() => void), cb?: () => void) {
    let mode: LOGLEVEL = this.http.statusCode < 500 ? LOGLEVEL.INFO : LOGLEVEL.ERROR;
    if (this.http.statusCode < 500) logger.info(`response ${this.http.statusCode} ${this.request.url.pathname}`);
    else logger.error(`response ${this.http.statusCode} ${this.request.url}`);
    if (this.ended) return;
    this.ended = true;
    this.http.end(...arguments);
  }

  json(data?: any) {
    if (data && (Array.isArray(data) || typeof data === "object")) this.end(JSON.stringify(data));
    else this.end(data);
  }

  status(code: CODES) {
    this.http.statusCode = code;
    return this;
  }
}

/**
 * instaniate http server
 * Creates http listener
 * Finds matched route
 * Authorize caller
 * Validates request body size
 * Validates input
 * Calls the related method if exists
 * @param service 
 */
function createServer() {
  logger.info('initializing Http server');
  server = http.createServer(async (httpRequest, httpResponse) => {
    try {
      let request = await createRequest(httpRequest);
      let response = new Response(request, httpResponse);
      let timer: NodeJS.Timeout = null;

      request.http.on('close', () => {
        clearTimeout(timer)
      });

      logger.info(`${request.method} ${request.url.pathname}`);
      logger.debug('body:')
      logger.debug(request.body);

      response.http.on("error", err => {
        logger.error(err, { method: request.method });
        if (typeof service.onError === "function") service.onError(request, response, err);
      });

      if (typeof service.onRequest === "function") {
        let ret = service.onRequest(request, response);
        if (ret && ret.then !== undefined) await ret;
      }

      console.log('request.url.pathname');
      if (request.url.pathname.indexOf('/socket.io') === 0) {
        console.log(serviceNamespaces);
        if (Object.keys(serviceNamespaces).length === 0) return response.status(CODES.NOT_FOUND).end();
      } else {

        let { route, params } = findRoute(request.url, <HttpMehod>request.method);

        if (!route || typeof service[route.key] !== "function") return response.status(CODES.NOT_FOUND).end();

        timer = setTimeout(() => {
          response.status(CODES.REQUEST_TIMEOUT).end('request time out');
        }, route.timeout);

        request.params = params;

        if (route.auth) {
          let auth = request.http.headers.authorization ? request.http.headers.authorization.split(' ')[1] : null;
          if (!auth) return response.status(CODES.UNAUTHORIZED).end("unauthorized");
          let user = await authorize(auth, route.name, { params: request.params, query: request.url.query, body: request.body });
          if (!user) return response.status(CODES.UNAUTHORIZED).end("unauthorized");
          request.user = user;
          request.auth = auth;
        }

        let queryStr = request.url.href.split('?')[1];
        if (route.queryLength > 0 && queryStr && request.url.search.length > route.queryLength) return response.status(CODES.REQUEST_ENTITY_TOO_LARGE).end('request query exceeded length limit');
        if (route.queryValidator) {
          let success = route.queryValidator.validate(request.url.query);
          if (!success) {
            logger.warn(route.queryValidator.error.message, { route: route.name });
            return response.status(CODES.BAD_REQUEST).json(route.queryValidator.error.message);
          }
        }

        if (route.bodyQuota > 0 && route.bodyQuota < +request.http.headers['content-length']) return response.status(CODES.REQUEST_ENTITY_TOO_LARGE).end('request body exceeded size limit');

        if (route.bodyValidator) {
          let success = route.bodyValidator.validate(request.body);
          if (!success) {
            logger.warn(route.bodyValidator.error.message, { route: route.name });
            return response.status(CODES.BAD_REQUEST).json(route.bodyValidator.error.message);
          }
        }

        try {
          service[route.key](request, response);
        } catch (e) {
          logger.error(e, { route: route.key });
        }
      }

    } catch (error) {
      logger.error(error);
    }
  });

  logger.info('http server initialized successfully');
  return server;
}

/**
 * Connect to Nats Server
 * Subscribe to all subjects
 * Check for msg error
 * Authorize caller
 * Validates msg body size
 * Validates msg body schema if exists
 * Calls the related method if exists
 */
async function InitiatlizeNatsSubscriptions(nats: Client) {
  let subscriptions = new Map<string, Subscription>();

  for (let key in serviceSubjects) {
    let subjectConf = serviceSubjects[key];

    if (typeof service[key] === "function") {
      let sub = await nats.subscribe(subjectConf.subject, async (err, msg) => {
        logger.info(`subject called: ${subjectConf.subject}`);

        if (err) return logger.error(err, { subject: subjectConf.subject, method: key });

        logger.debug('msg:');
        logger.debug(msg);

        if (subjectConf.auth) {
          let user = await authorize(msg.data.authorization, subjectConf.subject, { body: msg.data });
          if (!user) return logger.warn(`unauthorized message: ${subjectConf.subject}`);
          msg.data.user = user;
        }

        if (subjectConf.bodyQuota && subjectConf.bodyQuota < msg.size)
          return logger.warn('msg body quota exceeded');

        if (subjectConf.bodyValidator) {
          let success = subjectConf.bodyValidator.validate(msg.data);
          if (!success) return logger.warn(subjectConf.bodyValidator.error.message);
        }

        try {
          service[key](nats, msg);
        } catch (e) {
          logger.error(e, { subject: { name: subjectConf.subject, msg }, method: key });
        }
      }, subjectConf.options);

      subscriptions.set(key, sub);
    }

    return subscriptions;
  }
}

/**
 * initialize each socketIO defined namespace
 * check for handshake and authorizations
 * check for middlewares
 * listen to all defined custome events and lifecycle events
 * @param io 
 * @param namespace 
 * @param options 
 */
async function initializeNamespace(io: SocketIO.Server, namespace: string, options: Namespace) {
  let ns = namespace === 'default' ? io : io.of(`/${namespace}`);

  if (options.handshake || options.use) {
    ns.use(async (socket, next) => {
      options.use && typeof service[options.use] === "function" && service[options.use](ns, socket, next);

      if (options.handshake && typeof service[options.handshake] === "function") {
        if (options.auth) {
          let token = socket.handshake.query.auth;

          if (!token)
            return next(new Error('token_required'));

          try {
            let user = await authorize(token, namespace, null);
            (<any>socket).user = user;
          } catch (e) {
            if (e.statusCode && e.error) return next(new Error(e.error.message));
            return next(new Error('error_authorizing_request'));
          }

          service[options.handshake](ns, socket, next);
        }
      }
    });
  }

  ns.on('connection', socket => {
    if (options.connect)
      try { service[options.connect](ns, socket); } catch (e) { logger.error(e, { event: { name: 'connect' } }); }
    if (options.reconnect)
      socket.on('connect', () => {
        try { service[options.reconnect](ns, socket); } catch (e) { logger.error(e, { event: { name: 'reconnect' } }) }
      });
    if (options.useSocket)
      socket.use((packet, next) => {
        try { service[options.useSocket](ns, packet, next); } catch (e) { logger.error(e, { event: { name: 'userSocket' } }) }
      });
    if (options.disconnect)
      socket.on('disconnect', () => {
        try { service[options.disconnect](ns, socket); } catch (e) { logger.error(e, { event: { name: 'disconnect' } }) }
      });
    for (let event in options.events)
      socket.on(event, (...args) => {
        try { service[options.events[event]](ns, socket, ...args); } catch (e) { logger.error(e, { event: { name: event, data: args } }) }
      });
  });

  return ns;
}

function initilizaSocketMessaging() {
  process.on('message', (msg: WorkerMessage) => {
    if (msg.message !== 'publish' || !msg.data) return;

    let namespace: string = msg.namespace || 'defualt';
    let event: string = msg.event;
    let room: string = msg.room;
    let socketId: string = msg.socket;
    let broadcast: boolean = !!msg.broadcast;
    let payload: any[] = msg.payload;
    let ns: SocketIO.Server | SocketIO.Namespace = Micro.namespaces.get(namespace);

    if (!namespace) return;
    if (!socketId) {
      if (!room) return ns.to(room).emit(event, ...payload);
      return ns.emit(event, ...payload);
    } else {
      let io = <SocketIO.Server>Micro.namespaces.get('default');
      if (io.sockets.sockets[socketId] === undefined) {
        if (!broadcast) return;
        if (room) return ns.to(room).emit(event, ...payload);
        return ns.emit(event, ...payload);
      }
      let socket = io.sockets.sockets[socketId];
      if (room) return socket.to(room).emit(event, ...payload);
      return broadcast ? socket.broadcast.emit(event, ...payload) : socket.emit(event, ...payload);
    }
  });
}

/**
 * Initialize socketIO server configurations
 * Set max listeners
 * connect to redis if requested
 * @param server 
 * @param service 
 */
async function createSocketIO() {
  logger.info('initializing socketIO server');
  let ioOptions = Object.assign({ origin: '*:*' }, serviceConfig.socket ? serviceConfig.socket.serverOptions || {} : {});
  let io = SocketIO(server, ioOptions);
  io.sockets.setMaxListeners(serviceConfig.socket ? serviceConfig.socket.maxListeners || 10 : 10);
  let namespaces = new Map<string, SocketIO.Server | SocketIO.Namespace>();

  for (let namespace in serviceNamespaces) {
    let ns = await initializeNamespace(io, namespace, serviceNamespaces[namespace]);
    namespaces.set(namespace, ns);
  }

  if (serviceConfig.workers !== 0) initilizaSocketMessaging();

  if (!namespaces.has('default')) namespaces.set('default', io);
  logger.info('socketIO server initiatlized successfully');
  return namespaces;
}

/**
 * called when when service exits
 * close nats server connetion
 * call service onDestroy hook if exists
 */
function destory(signal: NodeJS.Signals) {
  logger.warn(`service exited with signal: ${signal}`);
  !!Micro.nats && Micro.nats.close();
  if (typeof service.onDestroy === 'function') service.onDestroy(signal);
  process.exit(0);
}

/**
 * listen to unhandled rejections an exceptions
 * log error
 * call related hook if exists
 * exit process if config.exitOnUnhandledException is set to true
 */
process
  .on('unhandledRejection', (reason, p) => {
    logger.error({ reason, msg: 'Unhandled Rejection', promise: p });
    if (service && typeof service.onUnhandledRejection === "function") service.onUnhandledRejection(reason, p);
  })
  .on('uncaughtException', err => {
    logger.error(err);
    if (service && typeof service.onUnhandledException === "function") service.onUnhandledException(err);
    // serviceConfig.exitOnUnhandledException && process.exit(1);
    process.exit(1);
  });

export interface SocketIOPublishMessage {
  event: string;
  data: any[];
  namespace?: string;
  room?: string;
  socketId?: string;
  broadcast?: boolean;
}


/**
 * export Micro Class with:
 * logger instance
 * nats client
 * nats subjects subscriptions
 * socketIO namespaces
 */
export class Micro {
  static logger = logger;
  static nats: Client = null;
  static subscriptions: Map<string, Subscription>;
  static namespaces: Map<string, SocketIO.Server | SocketIO.Namespace>;

  static message(msg: string, data: any = null, target: 'all' | 'others' = 'others') {
    process.send({ message: msg, target, data });
  }

  static publish(msg: SocketIOPublishMessage) {
    process.send({ message: 'publish', ...msg });
  }

  /**
   * instantiate service
   * implement service log if exist
   * call lifecycle hooks if exists
   * call createHttpServer function
   * call createNatsServer function if config was set
   * call createSocketIo function if configuration was set
   * listen to termination signals
   * run http server listener
   * @param ServiceClass 
   */
  static async start(ServiceClass: any) {
    if (cluster.isMaster && !!serviceConfig.workers) return new WorkersManager(logger, serviceConfig.workers);

    service = new ServiceClass();
    logger.level = serviceConfig.logLevel;

    if (typeof service.log === 'function')
      logger.implements(service);

    if (typeof service.onInit === "function") {
      let promise: Promise<any> = service.init();
      if (promise && typeof promise.then === "function") {
        try {
          await promise;
        } catch (error) {
          logger.error(error);
        }
      }
    }

    if (Object.keys(processMsgsListners).length > 0)
      process.on('message', (msg: WorkerMessage) => {
        if (msg.message === 'publish') return;
        let key = processMsgsListners[msg.message];
        if (key && typeof service[key] === "function") service[key](msg.data);
      });

    for (let config of serviceRoutesRepo) {
      let route: RouteFullConfig = {
        path: URL.Clean(serviceConfig.name + '/' + serviceConfig.version + (config.path || '')),
        name: config.name || config.key,
        method: config.method || 'GET',
        requestType: config.requestType || 'application/json',
        bodyValidator: config.body ? new Validall({ id: config.key, schema: config.body, ...validatorDefualts }) : null,
        bodyQuota: config.bodyQuota || 1024 * 100,
        queryValidator: config.query ? new Validall({ id: config.key, schema: config.query, ...validatorDefualts }) : null,
        queryLength: config.queryLength || 100,
        auth: !!config.auth,
        timeout: (!config.timeout || config.timeout < 0) ? 1000 * 15 : config.timeout,
        key: config.key
      };

      serviceRoutes[route.method] = { [route.path]: route };
      logger.info(`route: ${route.path} - ${route.method} initialized`);
    }

    createServer();

    if (!!serviceConfig.nats) {
      try {

        logger.info('initializing nats server connection');
        Micro.nats = await connect(serviceConfig.nats);
        logger.info('connected to nats server successfully');
        Micro.subscriptions = await InitiatlizeNatsSubscriptions(this.nats);
      } catch (error) {
        logger.error(error);
        throw error;
      }
    }

    if (Object.keys(serviceNamespaces).length > 0) Micro.namespaces = await createSocketIO();

    if (typeof service.onReady === 'function') service.onReady();

    process.on('SIGTERM', (signal) => destory(signal));
    process.on('SIGHUP', (signal) => destory(signal));
    process.on('SIGINT', (signal) => destory(signal));
    process.on('SIGKILL', (signal) => destory(signal));
    process.on('SIGQUIT', (signal) => destory(signal));

    server.listen(serviceConfig.port, () => logger.info(`running http server on port: ${serviceConfig.port}, pid: ${process.pid}`));
  }
}