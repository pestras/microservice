# Pestras Microservice

**Pestras Microservice** as **PMS** is built on nodejs framework using typescript, supporting http rest service, nats server, socket io and can run multible instances based on
nodejs cluster with messageing made easy between workers.

# Template

```bash
$ git clone https://github.com/pestras/pestras-microservice-template
```

## Creating Service

In order to create our service we need to use **SERVICE** decorator which holds the main configuration of our service class.

```ts
import { SERVICE } from '@pestras/microservice';

@SERVICE({ version: 1 })
class Test {}
```

### Service Configurations

Name        | Type     | Defualt         | Description
----        | -----    | ------          | -----
version     | number   | 0               | Current verion of our service, versions are used on rest resource */someservice/v1/...*.
kebabCase   | boolean  | true            | convert class name to kebekCasing as *ArticlesQueryAPI* -> *articles-query-api*
port        | number   | 3000            | Http server listening port.   
host        | string   | 0.0.0.0         | Http server host.
workers     | number   | 0               | Number of node workers to run, if assigned to minus value will take max number of workers depending on os max cpus number
logLevel    | LOGLEVEL | LOGLEVEL.INFO   |
tranferLog  | boolean  | false           | Allow logger to transfer logs to the service **log** method
nats        | string \| number \| NatsConnectionOptions | null        | see [Nats Docs](https://docs.nats.io/)
exitOnUnhandledException | boolean | true |
socket | SocketIOOptions | null |
authTimeout | number | 15000 | auth method timeout
cors | IncomingHttpHeaders & { 'success-code'?: string } | [see cors](#cors) | CORS for preflights requests

#### LOGLEVEL Enum

**PMS** provides only four levels of logs grouped in an enum type **LOGLEVEL**

- LOGLEVEL.ERROR
- LOGLEVEL.WARN
- LOGLEVEL.INFO
- LOGLEVEL.DEBUG

### SocketIOOptions

Name | Type | default | Description
--- | --- | --- | ---
serverOptions | SocketIO.ServerOptions | null | see [socket.io docs](https://socket.io/docs/server-api/)
maxListeners  | number  | 10 |
adapter | any | null | SocketIO Adapter

### Cors

**PM** default cors options are:

```
'access-control-allow-methods': "GET,HEAD,PUT,PATCH,POST,DELETE",
'access-control-allow-origin': "*",
'Access-Control-Allow-Credentials': 'false',
'success-code': '204'
```

To change that, overwrite new values into cors options

```ts
@SERVICE({
  version: 1,
  cors: {
    'access-control-allow-methods': "GET,PUT,POST,DELETE",
    'content-type': 'application/json'
  }
})
class Test {}
```

## Micro

Before delving into service routes, subjects.. etc, let's find out how to run our service..

After defining our service class we use the **Micro** object to run our service through the *start* method.

```ts
import { SERVICE, Micro } from '@pestras/microservice';

@SERVICE({
  // service config
})
export class TEST {}

Micro.start(Test);
```

**Micro** object has another properties and methods that indeed we are going to use as well later in the service.

Name | Type | Description
--- | --- | ---
logger | Logger |
nats | NatsClient | see [Nats Docs](https://docs.nats.io/)
subscription | Map<string, NatsSubscription> | Holds all subsciptions defined in our service
namespaces | Map<string, SocketIO.Namespace> | Holds all namesspaces defind in our service
message | (msg: string, data: WorkerMessage, target: 'all' \| 'others') => void | A helper method to broadcast a message between workers
publish | (msg: SocketIOPublishMessage) => void | A helper method to organize communication between socketio servers among workers
request | (options: IFetchOptions) => Promise<{ statusCode: number, data: any }> | For http requests
attempt | (action: (curr: number) => Promise, options: AttemptOptions) | Multiple calls for promise helper function

## ROUTE DECORATOR

Used to define a route for a rest service.

**ROUTE** accepts an optional config object to configure our route.

Name | type | Default | Description
--- | --- | --- | --- 
name | string | Method name applied to | name of the route
path | string | '' | Service path pattern
method | HttpMethod | 'GET' | 
accepts | string | 'application/json | shortcut for 'Content-Type' header
hooks | string[] | [] | hooks methods that should be called before the route handler
bodyQuota | number | 1024 * 100 | Request body size limit
queryLength | number | 100 | Request query characters length limit
timeout | number | 15000 | Max time to handle the request before canceling

```ts
import { SERVICE, ROUTE } from '@pestras/microservice';

@SERVICE({
  version: 1,
  port: 3333
})
class Articles {

  @ROUTE({
    // /articles/v1/{id}
    path: '/{id}'
  })
  getArticle(req: Request, res: Response) {
    let id = req.params.id;

    // get artcle code

    res.json(article);
  }
}
```

### Request

**PMS** http request holds the original Node IncomingMessage with a few extra properties.

Name | Type | Description
--- | --- | ---
url | URL | URL extends Node URL class with some few properties, most used one is *query*.
params | { [key: string]: string } | includes route path params values.
body | any |
auth | any | useful to save some auth value.
headers | IncomingHttpHeaders | return all current request headers.
header | (key: string) => string | method to get specific request header value
locals | Object | to set any additional data 
http | NodeJS.IncomingMessage | 

### Request Path Patterns

**PM** path patterns are very useful that helps match specific cases

1. **/articles/{id}** - *id* is a param name that match any value: */articles/4384545*, */articles/45geeFEe8* but not */articles* or */articles/dsfge03tG9/1*

2. **/articles/{id}?** - same the previous one but id params is optional, so */articles* is acceptable.

3. **/articles/{cat}/{start}?/{limit}?** - cat params is required, however start and limit are optionals,
*/articles/scifi*, */articles/scifi/0*, */articles/scifi/0/10* all matched

4. **/articles/{id:^[0-9]{10}$}** - id param is constrained with a regex that allow only number value with 10 digits length only.

5. **/articles/*** - this route has rest operator which holds the value of the rest of the path,
*articles/scifi/0/10* does match and **request.params['\*']** equals 'scifi/0/10', however */articles* does not match

6. **/articles/*?** - same as the previous however */articles* does match

#### notes:

- Rest operator accepts preceding parameter but not optional parameters.
- Adding flags to regexp would be */articles/{id:[a-z]{10}**:i**}*.
- Parameters with Regexp can be optional as will */articles/{id:[a-z]{10}**:i**}?*
- Parameters can be seperated by fixed value blocks */articles/{aid}/comments/{cid}*
- Parameters and rest operator can be seperated by fixed value blocks as well.
- On each request, routes are checked in two steps to enhance performance
  - Perfect match: Looks for the perfect match (case sensetive).
  - By Order: if first step fail, then routes are checked by order they were defined (case insensetive)

```ts
@SERVICE()
class AticlesQuery {
  // first to check
  @ROUTE({ path: '/{id}'})
  getById() {}
  
  // second to check
  @ROUTE({ path: '/published' })
  getPublished() {}
  
  /**
   * Later when an incomimg reauest made including pathname as: 'articles-query/v0/Published' with capitalized P
   * first route to match is '/{id}',
   * However when the path name is 'articles-query/v0/published' with lowercased p '/published' as the defined route then
   * the first route to match is '/published' instead of '/{id}'
   */
}
```

### Response

**PMS** http response holds the original Node Server Response with a couple of methods.

Name | Type | Description
--- | --- | ---
json | (data?: any) => void | Used to send json data.
status | (code: number) => Response | Used to set response status code.
type | (contentType: string) => void | assign content-type response header value.
end | any | Overwrites orignal end method *recommended to use*
setHeader | (headers: { [key: string]: string \| string[] \| number }) => void | set multiple headers at once
http | NodeJS.ServerResponse | 

Using response.json() will set 'content-type' response header to 'application/json'.
**Response** will log any 500 family errors automatically.

#### Response Security headers

**PM** add additional response headers fro more secure environment as follows:

```
'Cache-Control': 'no-cache,no-store,max-age=0,must-revalidate'
'Pragma': 'no-cache'
'Expires': '-1'
'X-XSS-Protection': '1;mode=block'
'X-Frame-Options': 'DENY'
'Content-Security-Policy': "script-src 'self'"
'X-Content-Type-Options': 'nosniff'
```


Headers can be overwritten using **response.setHeaders** method, 

## HOOK DECORATOR

Hooks are called before the atual request handler, they are helpful for code separation like auth, input validation or whatever logic needed, they could be sync or async returning boolean value.

Hooks accepts an optional timeout argument defaults to 10s, and the hook handler will get three inputs (request, response, handlerName: name of the method that called the hook).

```ts
import { Micro, SERVICE, Request, Response, HOOK, ROUTE, CODES } from '@pestras/microservice';

@SERVICE()
class TEST {
  @HOOK(10000)
  async auth(req: Request, res: Response, handlerName: string) {
    const user: User;
  
    // some auth code
    // ...

    if (!user) {
      res.status(CODES.UNAUTHORIZED).json({ msg: 'user not authorized' });
      return false;
    }
  
    req.auth = user;
    return true
  }

  @ROUTE({ hooks: ['auth'] })
  handlerName(req: Request, res: Response) {
    const user = req.auth;
  }
}

Micro.start(Test);
```

Hooks should handle the response on failure and returning or resolving to false, otherwise **PM** will check response status and if its not ended, it will consider the situation as a bad request from client that did not pass the hook and responding with BAD_REQUEST code 400.


## SUBJECT DECORATOR

Used to subscribe to nats server pulished subjects, and also accepts a config object.

Name | Type | Required | Default | Description
--- | --- | --- | --- | ---
subject | string | true | - | Nats server subject pattern
hooks | string[] | [] | hooks methods that should be called before the route handler
dataQuota | number | false | 1024 * 100 | Subject msg data size limit
payload | Nats.Payload | false | Payload.JSON | see [Nats Docs](https://docs.nats.io/)
options | Nats.SubscriptionOptions | false | null | see [Nats Docs](https://docs.nats.io/)

```ts
import { SERVICE, SUBJECT } from '@pestras/microservice';

@SERVICE({
  version: 1,
  port: 3334,
  workers: 4
})
class Email {

  // hooks works with subjects as well
  // arguments are swaped with (nats: Nats.Client, msg: Nats.Msg, handlerName: string - name of the subject handler method that called the hook)
  @Hook(5000)
  async auth(nats: Nats.Client, msg: Nats.Msg, handlerName: string) {
    // if hook failed its purpose should return false and check for msg reply if exists
    if (msg.reply) nats.publish(msg.replay, { error: 'some error' })
    return false

    // otherwise
    return true;
  }

  @SUBJECT({
    subject: 'user.insert',
    hooks: ['auth'],
    options: { queue: 'emailServiceWorker' }
  })
  sendActivationEmail(nats: Nats.Client, msg: Nats.Msg) {
    let auth = msg.data.auth;
  }
```

*Note: Both validation and auth methods context is changed to the service instance
but we need to inform typescript by defining the type of 'this' to the service class name.*

# SocketIO

**PMS** provides several decorators to manage our SocketIO server.

## CONNECT DECORATOR

This decorator will call the method attached to whenever a new socket has connected,
it accepts an optional array of namespaces names, defaults to ['default'] which is the main **io** server instance.

```ts
import { SERVICE, CONNECT } from '@pestras/microservice';

@SERVICE()
class Publisher {

  @CONNECT()
  onSocketConnect(io: SocketIO.Servier, socket: SocketIO.Socket) {}

  @CONNECT(['blog'])
  onSocketConnectToBlog(ns: SocketIO.Namespace, socket: SocketIO.Socket) {}
}
```

## RECONNECT DECORATOR

Called whenever a socket reconnect to the namespace or the server.

```ts
import { SERVICE, RECONNECT } from '@pestras/microservice';

@SERVICE()
class Publisher {

  @RECONNECT()
  onSocketReconnect(io: SocketIO.Servier, socket: SocketIO.Socket) {}

  @RECONNECT(['blog'])
  onSocketReconnectToBlog(ns: SocketIO.Namespace, socket: SocketIO.Socket) {}
}
```

## HANDSHAKE DECORATOE

Called when a socket establish a coonection for the first time, mostly used for authorization.

It accepts an optional array of namespaces names and defaults to ['defualt'].

The second parameter is for auth helper.

```ts
import { SERVICE, HANDSHAKE } from '@pestras/microservice';

@SERVICE()
class Publisher {

  @HANDSHAKE()
  handshake(io: SocketIO.Servier, socket: SocketIO.Socket, next: (err?: any) => void) {}

  @HANDSHAKE(['blog'])
  blogHandshake(ns: SocketIO.Namespace, socket: SocketIO.Socket, next: (err?: any) => void) {
    
  }
}
```

## USE DECORATOE

Same as **HANDSHAKE** decorator, however no auth method expected.

```ts
import { SERVICE, USE } from '@pestras/microservice';

@SERVICE()
class Publisher {

  @USE()
  use(io: SocketIO.Servier, socket: SocketIO.Socket, next: (err?: any) => void) {}

  @USE(['blog'])
  blogUse(ns: SocketIO.Namespace, socket: SocketIO.Socket, next: (err?: any) => void) {}
}
```

## USESOCKET DECORATOE

Used to listen to all socket incoming events.

```ts
import { SERVICE, USESOCKET } from '@pestras/microservice';

@SERVICE()
class Publisher {

  @USESOCKET()
  useSocket(io: SocketIO.Servier, packet: SocketIO.Packet, next: (err?: any) => void) {}

  @USESOCKET(['blog'])
  blogUseSocket(ns: SocketIO.Namespace, packet: SocketIO.Packet, next: (err?: any) => void) {}
}
```

## EVENT DECORATOE

Used to listen to a specific event, accepts an event name as a first parameter and an optional array of namespaces for the second defaults to ['default'].

```ts
import { SERVICE, EVENT } from '@pestras/microservice';

@SERVICE()
class Publisher {

  @EVENT('userLoggedIn')
  userLoggedIn(io: SocketIO.Servier, socket: SocketIO.Socket, ...args: any[]) {}

  @EVENT('newArticle', ['blog'])
  newArticle(ns: SocketIO.Namespace, socket: SocketIO.Socket, ...args: any[]) {}
}
```

## DISCONNECT DECORATOE

Triggered when a socket disconnect form the namespace or the server.

```ts
import { SERVICE, DISCONNECT } from '@pestras/microservice';

@SERVICE()
class Publisher {

  @DISCONNECT()
  socketDisconnected(io: SocketIO.Servier, packet: SocketIO.Packet) {}

  @DISCONNECT(['blog'])
  blogSocketDisconnected(ns: SocketIO.Namespace, socket: SocketIO.Socket) {}
}
```

# Cluster

**PMS** uses node built in cluster api, and made it easy for us to manage workers communications.

First of all to enable custering we should set workers number in our service configurations to some value other than zero.

```ts
import { SERVICE } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {}
```

To listen for a message form another process.

```ts
import { SERVICE, MSG } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {

  @MSG('some message')
  onSomeMessage(data: any) {}
}
```

To send a message to other processes we need to use *Micro.message* method, it accepts three parameters.

Name | Type | Required | Default | Description
--- | --- | ---- | --- | ---
message | string | true | - | Message name
data | any | false | null | Message payload
target | 'all' \| 'others' | false | 'others' | If we need the same worker to receive the message as well.

```ts
import { SERVICE, Micro } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {
  
  // some where in your service
  Micro.message('some message', { key: 'value' });
}
```

In case of not usong a socket io adapter, **PMS** provide another helper method to manage communications between workers for handling socket io broadcasting using *Micro.publish* method which accepts SocketIOPublishMessage object.

Name | Type | Required | Default | Description
--- | --- | ---- | --- | ---
event | string | true | - | Event name that needs to be published
data | any[] | true | - | event payload array distributed on multipe arguments
namespace | string | false | 'default' | If we need to publish through a specific namespace
room | string | false | null | If we need to publish to a specific room
socketId | string | false | null | In case we need to send to specific socket or exclude it from the receivers
broadcast | boolean | false | false | When socketId is provided and broadcast set to true socket will be excluded it from receivers

```ts
import { SERVICE, EVENT, Micro } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {

  @EVENT('ArticleUpdated', ['blog'])
  onArticleUpdate(ns: SocketIO.Namespace, socket: SocketIO.Socket, id: string) {
    socket.to('members').emit('ArticleUpdated', id);
    // publish to other worker socket io
    Micro.publish({
      event: 'ArticleUpdated',
      data: [id],
      namespace: 'blog',
      room: 'members'
    });
  }
}
```

Also it is made easy to restart all workers or the current one.

```ts
import { SERVICE, Micro } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {

  // some where in our service

  // restarting all workers
  Micro.message('restart all');

  // restarting the current worker
  Micro.message('restart');
}
```

When restarting all workers, it is going to be one by one process, **PMS** is going to wait for the new
worker to start listening and then will restart the next one.

# Attempt helper

When multiple attempts on failure to reach the database for example **attempt** method whould be the right thing to use

```ts
@SERVICE()
class Article {
  
  @ROUTE()
  async getArticles(req, res) {
    try {
      // find articles will be called 3 times, with 5 sec waiting on each failure
      let articles = await Micro.attampt(
        (curr: number) => articles.find({ ... }),
        { tries: 3, interval: 5000 }
      );
    } catch (e) {
      // after all attempts failed
    }
  }
}
```

**attempt** can have a canceler if we want to set timeout for each request

```ts
@SERVICE()
class Article {
  
  @ROUTE()
  async getArticles(req, res) {
    try {
      // find articles will be called 3 times, with 5 sec waiting on each failure or cancel on timeout
      let articles = await Micro.attampt(
        (curr: number) => articles.find({ ... }),
        (promise) => {
          // terminate promise some how
        },
        // setting timeout option
        { tries: 3, interval: 5000, timeout: 5000 }
      );
    } catch (e) {
      // after all attempts failed or canceled on timeout
    }
  }
}
```

# Lifecycle & Events Methods

**PMS** will try to call some service methods in specific time or action if they were already defined in our service.

## onInit

When defined, will be called once our service is instantiated but nothing else, this method is useful when
we need to connect to a databese or to make some async operations before start listening one events or http requests.

It can return a promise or nothing.

```ts
import { SERVICE, ServiceEvents } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher implements ServiceEvents {

  async onInit() {
    // connect to a databese
    return;
  }
}
```

## onReady

This method is called once all our listeners are ready.

```ts
import { SERVICE, ServiceEvents } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher implements ServiceEvents {

  onReay() {}
}
```

## onExit

Called once our service is stopped for any reason, and the exit signal is passed as an argument.

```ts
import { SERVICE, ServiceEvents } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher implements ServiceEvents {

  onExit(signal: NodeJS.Signals) {
    // disconnecting from the databese
  }
}
```

## OnLog

**PMS** has a built in lightweight logger that logs everything to the console.

In order to change that behavior we can define **onLog** event method in our service and **PMS** will detect that method and will transfer all logs to it, besides enabling **transferLog**
options in service config.

```ts
import { SERVICE, SUBJECT, Micro, ServiceEvents } from '@pestras/microservice';

@SERVICE({
  version: 1
  transferLog: process.env.NODE_ENV === 'production'
})
class Test implements ServiceEvents {

  onLog(level: LOGLEVEL, msg: any, extra: any) {
    // what ever you want
  }

  @SUBJECT({ subject: 'newArticle' })
  newArticle() {
    try {

    } catch (e) {
      Micro.logger.error('some error', e);
    }
  }
}
```

## onHealthcheck

An event triggered for docker swarm healthcheck.

```ts
@SERVICE()
class Publisher implements ServiceEvents {

  // http: GET /healthcheck
  async onHealthcheck(res: Response) {
    // check for database connection
    if (dbConnected) res.status(200).end();
    else res.status(500).end()
  }
}
```

## onReadycheck

An event triggered for kubernetes ready check.

```ts
@SERVICE()
class Publisher implements ServiceEvents {

  // http: GET /readiness
  async onReadycheck(res: Response) {
    // check for database connection
    if (dbConnected) res.status(200).end();
    else res.status(500).end()
  }
}
```

## onLivecheck

An event triggered for kubernetes live check.

```ts
@SERVICE()
class Publisher implements ServiceEvents {

  // http: GET /liveness
  async onLivecheck(res: Response) {
    // check for database connection
    if (dbConnected) res.status(200).end();
    else res.status(500).end()
  }
}
```

## onRequest

Called whenever a new http request is received, passing the Request and Response instances as arguments, it can return a promise or nothing;

```ts
@SERVICE()
class Publisher implements ServiceEvents {

  async onRequest(req: Request, res: Response) { }
}
```

This event method is called before authorizing the request or even before checking if there is a matched route or not.

## on404

Called whenever http request has no route handler found.

```ts
@SERVICE()
class Publisher implements ServiceEvents {

  on404(req: Request, res: Response) {

  }
}
```

When implemented response should be implemented as well

## onError

Called whenever an error accured when handling an http request, passing the Request and Response instances and the error as arguments.

```ts
@SERVICE({ workers: 4 })
class Publisher implements ServiceEvents {

  onError(req: Request, res: Response, err: any) { }
}
```

## onUnhandledRejection

I think it is clear by only reading the name.

```ts
@SERVICE({ workers: 4 })
class Publisher implements ServiceEvents {

  onUnhandledRejection(reason: any, p: Promise<any>) { }
}
```

## onUnhandledException

Also clear.

```ts
@SERVICE({ workers: 4 })
class Publisher implements ServiceEvents {

  onUnhandledException(err: any) { }
}
```

# Health Check

For health check in Dockerfile or docker-compose

```Dockerfile
HEALTHCHECK --interval=1m30s --timeout=2s --start_period=10s CMD node ./node_modules/@pestras/microservice/hc.js /articles/v0 3000
```

```yml
healthcheck:
  test: ["CMD", "node", "./node_modules/@pestras/microservice/hc.js", "/articles/v0", "3000"]
  interval: 1m30s
  timeout: 10s
  retries: 3
  start_period: 40s
```
Root path is required as the first parameter, while port defaults to 3000.

Thank you