import * as http from 'http';
import * as Nats from 'ts-nats';
import * as SocketIO from 'socket.io';
import * as cluster from 'cluster';
import { WorkerMessage, WorkersManager } from './workers';
import { LOGLEVEL, Logger } from './logger';
import { URL } from '@pestras/toolbox/url';
import { PathPattern } from '@pestras/toolbox/url/path-pattern';
import { fetch, IFetchOptions, CODES } from '@pestras/toolbox/fetch';
import { IncomingHttpHeaders } from 'http2';

export { CODES, LOGLEVEL };

export interface NatsMsg<T = any> extends Nats.Msg {
  data?: T;
}

/**
 * Service Interface
 */
interface Service {
  [key: string]: any;
}

/**
 * Globals:
 * nats server, httpServer, SocketIO Server and the micro service instance
 */
// let nats: Client;
let server: http.Server;
let service: Service;
let subServicesList: any[] = [];

/**
 * logger instance
 */
let logger = new Logger();

interface ProcessMsgsListeners {
  [key: string]: {
    service: any;
    key: string;
  };
}

const processMsgsListners: ProcessMsgsListeners = { };

export interface SocketIOOptions {
  serverOptions?: SocketIO.ServerOptions;
  maxListeners?: number;
  adapter?: any;
}

/**
 * Service Decorator options
 */
export interface ServiceConfig {
  version?: number;
  kebabCase?: boolean;
  port?: number;
  host?: string;
  workers?: number;
  logLevel?: LOGLEVEL;
  transferLog?: boolean;
  nats?: string | number | Nats.NatsConnectionOptions;
  exitOnUnhandledException?: boolean;
  exitOnInhandledRejection?: boolean;
  socket?: SocketIOOptions;
  cors?: IncomingHttpHeaders & { 'success-code'?: string };
}

/**
 * Service Config Object
 */
let serviceConfig: ServiceConfig & { name: string };
const DEFAULT_CORS: IncomingHttpHeaders & { 'success-code'?: string } = {
  'access-control-allow-methods': "GET,HEAD,OPTIONS,PUT,PATCH,POST,DELETE",
  'access-control-allow-origin': "*",
  'access-control-allow-headers': "*",
  'Access-Control-Allow-Credentials': 'false',
  'success-code': '204'
}

export type HttpMehod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface IRedisOptions {
  host: string;
  port: number;
  pass?: string;
}

function toKebabCasing(name: string) {
  if (!name) return '';

  return name.replace(/([a-z0-9][A-Z])/g, (match: string, $1: string) => {
    return $1.charAt(0) + '-' + $1.charAt(1).toLowerCase()
  });
}

/**
 * Service Decorator
 * accepts all service config
 * @param config 
 */
export function SERVICE(config: ServiceConfig = {}) {
  return (constructor: any) => {
    let cors = Object.assign({}, DEFAULT_CORS);
    let name = config.kebabCase === false ? constructor.name.toLowerCase() : toKebabCasing(constructor.name).toLowerCase();
    serviceConfig = {
      name,
      kebabCase: config.kebabCase === false ? false : true,
      version: config.version || 0,
      workers: config.workers || 0,
      logLevel: config.logLevel || LOGLEVEL.INFO,
      transferLog: !!config.transferLog,
      exitOnUnhandledException: config.exitOnUnhandledException === undefined ? true : !!config.exitOnUnhandledException,
      exitOnInhandledRejection: config.exitOnInhandledRejection === undefined ? true : !!config.exitOnInhandledRejection,
      port: config.port || 3000,
      host: config.host || '0.0.0.0',
      nats: config.nats,
      socket: config.socket,
      cors: Object.assign(cors, config.cors || {})
    }
  }
}

export function MSG(processMsg: string) {
  return function (target: any, key: string) {
    processMsgsListners[processMsg] = { key, service: target.constructor };
  }
}

/**
 * Route Config interface
 */
export interface RouteConfig {
  name?: string;
  path?: string;
  method?: HttpMehod;
  /** default: application/json; charset=utf-8 */
  accepts?: string;
  hooks?: string[];
  bodyQuota?: number;
  processBody?: boolean;
  queryLength?: number;
  timeout?: number;
}

interface RouteFullConfig extends RouteConfig {
  key?: string;
  service?: any;
};

/**
 * Routes repo interface
 */
export interface Routes {
  GET?: { [key: string]: RouteFullConfig };
  HEAD?: { [key: string]: RouteFullConfig };
  POST?: { [key: string]: RouteFullConfig };
  PUT?: { [key: string]: RouteFullConfig };
  PATCH?: { [key: string]: RouteFullConfig };
  DELETE?: { [key: string]: RouteFullConfig };
}

/**
 * Routes repo object that will hold all defined routes
 */
let serviceRoutes: Routes = {};
let serviceRoutesRepo: RouteFullConfig[] = [
  { path: '/healthcheck', key: 'healthcheck', method: 'GET' },
  { path: '/readiness', key: 'readiness', method: 'GET' },
  { path: '/liveness', key: 'liveness', method: 'GET' }
];

/**
 * Route decorator
 * accepts route configuration
 * @param config 
 */
export function ROUTE(config: RouteConfig = {}) {
  return (target: any, key: string) => {
    serviceRoutesRepo.push({ key, service: target.constructor, ...config });
  }
}

/** Hooks Repo */
const hooksRepo: string[] = [];

/** Hook Decorator */
export function HOOK() {
  return (target: any, key: string) => {
    hooksRepo.push(key);
  }
}

/**
 * Nats Subject config interface
 */
export interface SubjectConfig {
  hooks?: string[];
  dataQuota?: number;
  payload?: Nats.Payload;
  options?: Nats.SubscriptionOptions;
}

export interface SubjectFullConfig extends SubjectConfig {
  key?: string;
  service?: any;
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
export function SUBJECT(subject: string, config: SubjectConfig = {}) {
  return (target: any, key: string) => {
    serviceSubjects[subject] = {
      service: target.constructor,
      options: config.options || {},
      hooks: config.hooks || [],
      dataQuota: config.dataQuota || 1024 * 100,
      payload: config.payload || Nats.Payload.JSON,
      key
    }
  };
}

/**
 * Socket IO namespace config interface
 */
export interface IONamespace {
  service: any;
  connect?: string;
  reconnect?: string;
  handshake?: string;
  use?: string;
  useSocket?: string;
  events?: { [key: string]: string };
  disconnect?: string;
}

/**
 * Socket IO namespaces repo
 */
let serviceNamespaces: { [key: string]: IONamespace } = {};

/**
 * Socket IO connect decorator
 * accepts list of namespaces names
 * @param namespaces 
 */
export function CONNECT(namespaces: string[] = ['default']) {
  return (target: any, key: string) => {
    for (let namespace of namespaces) {
      serviceNamespaces[namespace] = serviceNamespaces[namespace] || { service: target.constructor };
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
      serviceNamespaces[namespace] = serviceNamespaces[namespace] || { service: target.constructor };
      serviceNamespaces[namespace].reconnect = key;
    }
  }
}

/**
 * Socket IO handshake decorator
 * accepts list of namespaces names with auth boolean option
 * @param namespaces 
 */
export function HANDSHAKE(namespaces: string[] = ['default']) {
  return (target: any, key: string) => {
    for (let namespace of namespaces) {
      serviceNamespaces[namespace] = serviceNamespaces[namespace] || { service: target.constructor };
      serviceNamespaces[namespace].handshake = key;
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
      serviceNamespaces[namespace] = serviceNamespaces[namespace] || { service: target.constructor };
      serviceNamespaces[namespace].use = key;
    }
  }
}

/**
 * Socket IO usesocket decorator
 * accepts list of namespaces names
 * @param namespaces 
 */
export function USESOCKET(namespaces: string[] = ['default']) {
  return (target: any, key: string) => {
    for (let namespace of namespaces) {
      serviceNamespaces[namespace] = serviceNamespaces[namespace] || { service: target.constructor };
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
      serviceNamespaces[namespace] = serviceNamespaces[namespace] || { service: target.constructor };
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
export function DISCONNECT(namespaces: string[] = ['default']) {
  return (target: any, key: string) => {
    for (let namespace of namespaces) {
      serviceNamespaces[namespace] = serviceNamespaces[namespace] || { service: target.constructor };
      serviceNamespaces[namespace].disconnect = key;
    }
  }
}

/**
 * Finds the matched route method declared whtin the service
 * @param url {URL}
 * @param method {HttpMethod}
 */
function findRoute(url: URL, method: HttpMehod): { route: RouteFullConfig, params: { [key: string]: string | string[] } } {
  if (!serviceRoutes || !serviceRoutes[method])
    return null;

  let pathname = PathPattern.Clean(url.pathname)
  if (serviceRoutes[method][pathname] !== undefined) return { route: serviceRoutes[method][pathname], params: {} };

  for (let routePath in serviceRoutes[method]) {
    let route = serviceRoutes[method][routePath];
    let pathPattern = new PathPattern(route.path);
    if (pathPattern.match(pathname)) return { route, params: pathPattern.params };
  }

  return <any>{};
}

/**
 * Request wrapper for original node incoming message
 * include url and body parsing
 */
export class Request<T = any> {
  private _body: T = null;
  private _params: { [key: string]: string | string[] } = null;
  readonly url: URL;
  readonly method: HttpMehod;
  readonly locals: { [key: string]: any } = {};
  readonly cookies: { [key: string]: string } = {};
  auth?: any;

  constructor(public readonly http: http.IncomingMessage) {
    this.url = new URL('http://' + this.http.headers.host + this.http.url);
    this.method = <HttpMehod>this.http.method.toUpperCase();

    let rc = http.headers.cookie;
    rc && rc.split(';').forEach(cookie => {
      let parts = cookie.split('=');
      this.cookies[parts.shift().trim()] = decodeURI(parts.join("="));
    })
  }

  get body() { return this._body; }
  set body(value: T) {
    if (!this._body) this._body = value;
    else throw "unable to reassign request body";
  }

  get params() { return this._params; }
  set params(value: { [key: string]: string | string[] }) {
    if (!this._params) this._params = value;
    else throw "unable to reassign request params";
  }

  header(key: string) { return this.http.headers[key.toLowerCase()]; }

  get headers() { return this.http.headers; }
}

/**
 * Http request factory
 * @param socket 
 */
function processBody(http: http.IncomingMessage): Promise<any> {
  return new Promise((res, rej) => {
    let payload: Uint8Array[] = [];
    http.on("data", data => payload.push(data))
      .on('end', () => res(Buffer.concat(payload).toString()))
      .on("error", err => {
        logger.error(err);
        rej(err);
      });
  });
}

/**
 * Response wrapper over origin http.ServerResponse
 */
export class Response {
  private _ended: boolean;

  constructor(private request: Request, public readonly http: http.ServerResponse) {
    this.http.setHeader('Cache-Control', 'no-cache,no-store,max-age=0,must-revalidate');
    this.http.setHeader('Pragma', 'no-cache');
    this.http.setHeader('Expires', '-1');
    this.http.setHeader('X-XSS-Protection', '1;mode=block');
    this.http.setHeader('X-Frame-Options', 'DENY');
    this.http.setHeader('Content-Security-Policy', "script-src 'self'");
    this.http.setHeader('X-Content-Type-Options', 'nosniff');
    this.setHeaders(serviceConfig.cors);
  }

  get ended() { return this._ended; }

  end(cb?: () => void): void;
  end(chunck: any, cb?: () => void): void;
  end(chunck: any, encoding: string, cb?: () => void): void;
  end(chunck?: any | (() => void), encoding?: string | (() => void), cb?: () => void) {
    if (this._ended) return logger.warn('http response already sent');
    let mode: LOGLEVEL = this.http.statusCode < 500 ? LOGLEVEL.INFO : LOGLEVEL.ERROR;
    if (this.http.statusCode < 500) logger.info(`response ${this.http.statusCode} ${this.request.url.pathname}`);
    else logger.error(`response ${this.http.statusCode} ${this.request.url}`);
    this._ended = true;
    this.http.end(...arguments);
  }

  cookies(pairs: { [key: string]: string }) {
    if (!pairs) return this;
    let all: string[] = [];
    for (let [key, value] of Object.entries(pairs)) all.push(`${key}=${value}`);
    this.http.setHeader('Set-Cookie', all);
    return this;
  }

  type(type: string) {
    this.http.setHeader('Content-Type', type);
    return this;
  }

  setHeaders(headers: { [key: string]: string | string[] | number }) {
    if (headers)
      for (let key in headers)
        this.http.setHeader(key, headers[key]);

    return this;
  }

  json(data?: any) {
    this.http.setHeader('Content-Type', 'application/json; charset=utf-8');
    !!data ? this.end(JSON.stringify(data)) : this.end("");
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
      // let request = await createRequest(httpRequest);
      let request = new Request(httpRequest);
      let response = new Response(request, httpResponse);
      let timer: NodeJS.Timeout = null;

      request.http.on('close', () => {
        clearTimeout(timer);
      });

      logger.info(`${request.method} ${request.url.pathname}`);

      response.http.on("error", err => {
        logger.error(err, { method: request.method });
        if (typeof service.onError === "function") service.onError(request, response, err);
      });

      if (<any>request.method === 'OPTIONS') return response.status(+serviceConfig.cors['success-code']).end();

      if (typeof service.onRequest === "function") {
        let ret = service.onRequest(request, response);
        if (ret && ret.then !== undefined) await ret;
      }

      if (request.url.pathname.indexOf('/socket.io') === 0) {
        if (Object.keys(serviceNamespaces).length === 0) return response.status(CODES.NOT_FOUND).end();
      } else {

        let { route, params } = findRoute(request.url, <HttpMehod>request.method);

        if (!route) {
          if (typeof service.on404 === "function") return service.on404(request, response);
          return response.status(CODES.NOT_FOUND).end();
        }

        // healthcheck event
        if (route.name === 'healthcheck' && request.method === 'GET') {
          if (typeof service.onHealthcheck === "function") return service.onHealthcheck(response);
          else return response.status(200).end();
        }

        // readiness event
        if (route.name === 'readiness' && request.method === 'GET') {
          if (typeof service.onReadycheck === "function") return service.onReadycheck(response);
          else return response.status(200).end();
        }

        // liveness event
        if (route.name === 'liveness' && request.method === 'GET') {
          if (typeof service.onLivecheck === "function") return service.onLivecheck(response);
          else return response.status(200).end();
        }

        let currentService = route.service;

        if (typeof currentService.onRequest === "function") {
          let ret = currentService.onRequest(request, response);
          if (ret && ret.then !== undefined) await ret;
        }

        if (typeof currentService[route.key] !== "function") {
          if (typeof currentService.on404 === "function") return currentService.on404(request, response);
          return response.status(CODES.NOT_FOUND).end();
        }

        timer = setTimeout(() => {
          response.status(CODES.REQUEST_TIMEOUT).end('request time out');
        }, route.timeout);

        request.params = params;

        let queryStr = request.url.href.split('?')[1];
        if (route.queryLength > 0 && queryStr && request.url.search.length > route.queryLength)
          return response.status(CODES.REQUEST_ENTITY_TOO_LARGE).end('request query exceeded length limit');

        if (['POST', 'PUT', 'PATCH', 'DELETE'].indexOf(request.method) > -1 && +request.http.headers['content-length'] > 0) {
          // validate reeuest body size
          if (route.bodyQuota > 0 && route.bodyQuota < +request.http.headers['content-length'])
            return response.status(CODES.REQUEST_ENTITY_TOO_LARGE).end('request body exceeded size limit');

          if (route.accepts.indexOf((<string>request.header('content-type')).split(';')[0]) === -1)
            return response.status(CODES.BAD_REQUEST).json({ msg: 'invalidContentType' });

          if (route.processBody) {
            let data: any;
            try { data = await processBody(request.http); }
            catch (e) { return response.status(CODES.BAD_REQUEST).json({ msg: 'error processing request data', original: e }); }

            if (route.accepts.indexOf('application/json') > -1)
              try { request.body = JSON.parse(data); } catch (e) { return response.status(CODES.BAD_REQUEST).json(e); }
            else if (route.accepts.indexOf('application/x-www-form-urlencoded') > -1)
              request.body = URL.QueryToObject(data);
            else request.body = data;
          }
        }

        if (route.hooks && route.hooks.length > 0) {
          let currHook: string;
          try {
            for (let hook of route.hooks) {
              // check if response already sent, that happens when hook timeout
              if (response.ended) return;

              currHook = hook;

              if (currentService[hook] === undefined && service[hook] === undefined) return Micro.logger.warn(`Hook not found: ${hook}!`);
              else if (typeof currentService[hook] !== 'function' && typeof service[hook] !== "function") return Micro.logger.warn(`invalid hook type: ${hook}!`);

              let ret = currentService[hook] ? currentService[hook](request, response, route.key) : service[hook](request, response, route.key);
              if (ret) {
                if (typeof ret.then === "function") {
                  let passed = await ret;
                  if (!passed) {
                    if (!response.ended) {
                      logger.warn('unhandled async hook response: ' + hook);
                      response.status(CODES.BAD_REQUEST).json({ msg: 'badRequest' });
                    }
                    return;
                  }
                }

              } else {
                if (!response.ended) {
                  logger.warn('unhandled hook response: ' + hook);
                  response.status(CODES.BAD_REQUEST).json({ msg: 'badRequest' });
                }
                return;
              }
            }
          } catch (e) {
            logger.error('hook unhandled error: ' + currHook, e);
            response.status(CODES.UNKNOWN_ERROR).json({ msg: 'unknownError' });
          }
        }

        try { currentService[route.key](request, response); }
        catch (e) { logger.error(e, { route: route.key }); }
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
async function InitiatlizeNatsSubscriptions(nats: Nats.Client) {
  let subscriptions = new Map<string, Nats.Subscription>();

  for (let subject in serviceSubjects) {
    let subjectConf = serviceSubjects[subject];
    let currentService = getCurrentService(subjectConf.service) || service;

    if (typeof currentService[subjectConf.key] === "function") {
      logger.info('subscribing to subject: ' + subject);
      let sub = await nats.subscribe(subject, async (err, msg) => {
        logger.info(`subject called: ${subject}`);

        if (err) return logger.error(err, { subject: subject, method: subject });

        if (subjectConf.dataQuota && subjectConf.dataQuota < msg.size) {
          if (msg.reply) Micro.nats.publish(msg.reply, 'msg body quota exceeded');
          return logger.warn('msg body quota exceeded');
        }

        if (subjectConf.hooks && subjectConf.hooks.length > 0) {
          let currHook: string;

          try {
            for (let hook of subjectConf.hooks) {
              currHook = hook;

              if (currentService[hook] === undefined && service[hook] === undefined) return Micro.logger.warn(`Hook not found: ${hook}!`);
              else if (typeof currentService[hook] !== 'function' && typeof service[hook] !== 'function') return Micro.logger.warn(`invalid hook type: ${hook}!`);

              let ret = currentService[hook] ? currentService[hook](nats, msg, subject) : service[hook](nats, msg, subject);
              if (ret) {
                if (typeof ret.then === "function") {
                  let passed = await ret;

                  if (!passed) return logger.info(`subject ${msg.subject} ended from hook: ${hook}`);
                }

              } else return logger.info(`subject ${msg.subject} ended from hook: ${hook}`);
            }

          } catch (e) {
            if (msg.reply) Micro.nats.publish(msg.reply, { error: { msg: 'hook unhandled error' + currHook } });
            return logger.error(e);
          }
        }

        try {
          let ret = currentService[subjectConf.key](nats, msg);
          if (ret && typeof ret.then === "function") await ret;
          logger.info(`subject ${msg.subject} ended`);
        } catch (e) { logger.error(e, { subject: { name: subject, msg }, method: subject }); }

      }, subjectConf.options);

      subscriptions.set(subject, sub);
    }
  }

  return subscriptions;
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
async function initializeNamespace(io: SocketIO.Server, namespace: string, options: IONamespace) {
  let ns = namespace === 'default' ? io : io.of(`/${namespace}`);

  if (options.handshake || options.use) {
    ns.use(async (socket, next) => {
      options.use && typeof service[options.use] === "function" && service[options.use](ns, socket, next);
      options.handshake && typeof service[options.handshake] === "function" && service[options.handshake](ns, socket, next);
    });
  }

  ns.on('connection', socket => {
    let currService = getCurrentService(options.service) || service;
    if (options.connect)
      try { currService[options.connect](ns, socket); } catch (e) { logger.error(e, { event: { name: 'connect' } }); }
    if (options.reconnect)
      socket.on('connect', () => {
        try { currService[options.reconnect](ns, socket); } catch (e) { logger.error(e, { event: { name: 'reconnect' } }) }
      });
    if (options.useSocket)
      socket.use((packet, next) => {
        try { currService[options.useSocket](ns, packet, next); } catch (e) { logger.error(e, { event: { name: 'useSocket' } }) }
      });
    if (options.disconnect)
      socket.on('disconnect', () => {
        try { currService[options.disconnect](ns, socket); } catch (e) { logger.error(e, { event: { name: 'disconnect' } }) }
      });
    for (let event in options.events)
      socket.on(event, (...args) => {
        try { currService[options.events[event]](ns, socket, ...args); } catch (e) { logger.error(e, { event: { name: event, data: args } }) }
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
  if (serviceConfig.socket && serviceConfig.socket.adapter) io.adapter(serviceConfig.socket.adapter);
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
 * listen to unhandled rejections an exceptions
 * log error
 * call related hook if exists
 * exit process if config.exitOnUnhandledException is set to true
 */
process
  .on('unhandledRejection', (reason, p) => {
    logger.error('Unhandled Rejection', { reason });
    if (service && typeof service.onUnhandledRejection === "function") service.onUnhandledRejection(reason, p);
    else {
      if (p) p.catch(err => Micro.logger.error(err));
      if (serviceConfig) serviceConfig.exitOnInhandledRejection && Micro.exit(1, "SIGTERM");
    }
  })
  .on('uncaughtException', err => {
    logger.error('uncaughtException', { err });
    if (service && typeof service.onUnhandledException === "function") service.onUnhandledException(err);
    else if (serviceConfig) serviceConfig.exitOnUnhandledException && Micro.exit(1, "SIGTERM");
  });



function getCurrentService(constructor: any) {
  if (service?.constructor === constructor) return service;
  for (let subService of subServicesList) if (subService.constructor === constructor) return subService;
  return null;
}

export interface SocketIOPublishMessage {
  event: string;
  data: any[];
  namespace?: string;
  room?: string;
  socketId?: string;
  broadcast?: boolean;
}

export interface ServiceEvents {
  onLog?: (level: LOGLEVEL, msg: string, meta: any) => void;
  onInit?: () => void | Promise<void>;
  onReady?: () => void;
  onExit?: (code: number, signal: NodeJS.Signals) => void;
  onRequest?: (req: Request, res: Response) => void | Promise<void>;
  on404?: (req: Request, res: Response) => void;
  onError?: (req: Request, res: Response, err: any) => void;
  onUnhandledRejection?: (reason: any, p: Promise<any>) => void;
  onUnhandledException?: (err: any) => void;
  onHealthcheck?: (res: Response) => void;
  onReadycheck?: (res: Response) => void;
  onLivecheck?: (res: Response) => void;
}

export interface SubServiceEvents {
  onInit?: () => void | Promise<void>;
  onReady?: () => void;
  onRequest?: (req: Request, res: Response) => void | Promise<void>;
}

export interface AttemptOptions {
  tries?: number;
  interval?: number;
  timeout?: number;
}

export enum MICRO_STATUS {
  INIT = -1,
  EXIT = 0,
  LIVE = 1
}

let status: MICRO_STATUS = MICRO_STATUS.INIT;

/**
 * export Micro Class with:
 * logger instance
 * nats client
 * nats subjects subscriptions
 * socketIO namespaces
 */
export class Micro {
  static logger = logger;
  static nats: Nats.Client = null;
  static subscriptions: Map<string, Nats.Subscription>;
  static namespaces: Map<string, SocketIO.Server | SocketIO.Namespace>;
  static get status() { return status; }
  static readonly store = {}

  static message(msg: string, data: any = null, target: 'all' | 'others' = 'others') {
    process.send({ message: msg, target, data });
  }

  static publish(msg: SocketIOPublishMessage) {
    process.send({ message: 'publish', ...msg });
  }

  static request(options: IFetchOptions) {
    return fetch(options);
  }

  /**
   * helper method to 
   * @param action (curr: number) => Promise<T>
   * @param options AttemptOptions
   */
  static attempt<T>(action: (curr: number) => Promise<T>, options: AttemptOptions): Promise<T>
  static attempt<T>(action: (curr: number) => Promise<T>, canceler: ((promise: Promise<T>) => void), options: AttemptOptions): Promise<T>
  static attempt<T>(action: (curr: number) => Promise<T>, canceler: ((promise: Promise<T>) => void) | AttemptOptions = {}, options: AttemptOptions = {}): Promise<T> {
    options = typeof canceler === "function" ? options : canceler;
    canceler = typeof canceler === "function" ? canceler : null;
    let curr = 0;
    let interval = options.interval || 10000;
    let tryies = options.tries || 3;
    let timeout = options.timeout || 10000;
    let timerId: NodeJS.Timeout;

    return new Promise((res, rej) => {

      function trigger() {
        let prom = action(++curr);

        prom
          .then(data => {
            clearTimeout(timerId);
            res(data);
          })
          .catch(e => {
            clearTimeout(timerId);
            Micro.logger.warn(`attempt [${curr}]: faild`, e);
            if (curr >= tryies) rej(e);
            else setTimeout(() => trigger(), interval);
          });

        if (canceler)
          timerId = setTimeout(() => {
            clearTimeout(timerId);
            Micro.logger.warn(`attempt [${curr}]: timeout`);
            (<any>canceler)(prom);
            if (curr >= tryies) rej({ msg: 'timeout' });
            else setTimeout(() => trigger(), interval);
          }, timeout);
      }

      trigger();
    });
  }

  static exit(code = 0, signal: NodeJS.Signals = "SIGTERM") {
    status = MICRO_STATUS.EXIT;
    logger.warn(`cleaning up before exit`);
    !!server && server.close();
    !!Micro.nats && Micro.nats.close();
    if (typeof service.onExit === 'function') service.onExit(code, signal);
    logger.warn(`service exited with signal: ${signal}, code: ${code}`);
    process.exit(code);
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
  static async start(ServiceClass: any, subServices?: any[]) {
    if (cluster.isMaster && !!serviceConfig.workers) {
      new WorkersManager(logger, serviceConfig.workers);
      return;
    }

    service = new ServiceClass();
    logger.level = serviceConfig.logLevel;

    if (subServices?.length > 0)
      for (let subService of subServices) subServicesList.push(new subService());

    if (typeof service.log === 'function' && serviceConfig.transferLog)
      logger.transferTo(service);

    if (typeof service.onInit === "function") {
      let promise: Promise<any> = service.onInit();
      if (typeof promise?.then === "function")
        try { await promise; }
        catch (error) { logger.error(error); }
    }

    if (subServices?.length > 0) {
      for (let subService of subServices) {
        if (typeof subService.onInit === "function") {
          let promise: Promise<any> = subService.onInit();
          if (typeof promise?.then === "function")
            try { await promise; }
            catch (error) { logger.error(error); }
        }
      }
    }

    if (Object.keys(processMsgsListners).length > 0)
      process.on('message', (msg: WorkerMessage) => {
        if (msg.message === 'publish') return;
        let options = processMsgsListners[msg.message];
        let currService = getCurrentService(options.service) || service;
        if (options.key && typeof currService[options.key] === "function") currService[options.key](msg.data);
      });

    for (let config of serviceRoutesRepo) {
      let currService = getCurrentService(config.service) || service;
      let pathPrefix = '';
      if (currService !== service)
        pathPrefix = '/' + (serviceConfig.kebabCase ? toKebabCasing(currService.constructor.name) : currService.constructor.name as string).toLowerCase();

      let route: RouteFullConfig = {
        service: currService,
        path: URL.Clean("/" + serviceConfig.name + '/v' + serviceConfig.version + pathPrefix + (config.path || '')),
        name: config.name || config.key,
        method: config.method || 'GET',
        accepts: config.accepts || 'application/json; charset=utf-8',
        hooks: config.hooks || [],
        bodyQuota: config.bodyQuota || 1024 * 100,
        queryLength: config.queryLength || 100,
        processBody: config.processBody === false ? false : true,
        timeout: (!config.timeout || config.timeout < 0) ? 1000 * 15 : config.timeout,
        key: config.key
      };

      for (let hook of route.hooks)
        if (currService[hook] === undefined && service[hook] === undefined) Micro.logger.warn(`Hook not found: ${hook}!`);
        else if (typeof currService[hook] !== 'function' && typeof service[hook] !== 'function') Micro.logger.warn(`invalid hook type: ${hook}!`);

      serviceRoutes[route.method] = serviceRoutes[route.method] || {};
      serviceRoutes[route.method][route.path] = route;
      logger.info(`route: ${route.path} - ${route.method} initialized`);
    }

    createServer();

    if (!!serviceConfig.nats) {
      try {
        logger.info('initializing nats server connection');
        Micro.nats = await Nats.connect(serviceConfig.nats);
        logger.info('connected to nats server successfully');
        Micro.subscriptions = await InitiatlizeNatsSubscriptions(this.nats);
      } catch (error) {
        logger.error(error);
        throw error;
      }
    }

    if (Object.keys(serviceNamespaces).length > 0) Micro.namespaces = await createSocketIO();

    status = MICRO_STATUS.LIVE;
    if (typeof service.onReady === 'function') service.onReady();

    if (subServices?.length > 0)
      for (let subService of subServices)
        if (typeof subService.onReady === "function") subService.onReady();


    process.on('SIGTERM', (signal) => Micro.exit(0, signal));
    process.on('SIGHUP', (signal) => Micro.exit(0, signal));
    process.on('SIGINT', (signal) => Micro.exit(0, signal));

    server.listen(serviceConfig.port, serviceConfig.host, () => logger.info(`running http server on port: ${serviceConfig.port}, pid: ${process.pid}`));
  }
}