# Pestras Microservice

**Pestras Microservice** as **PMS** is built on nodejs framework using typescript, supporting http rest service, nats server, socker io and can run multible instances based on
nodejs cluster with messageing made easy between workers.

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
port        | number   | 3888            | Http server listening port.   
workers     | number   | 0               | Number of node workers to run, if assigned to minus value will take max number of workers depending on os max cpus number
logLevel    | LOGLEVEL | LOGLEVEL.INFO   | 
validatorDefaults | ValidatorDefaults | { strict: false, filter: false, required: false, nullable: false } | These are **Validall** defualt options when validating requests body as we're going to see later, for more info on **Validall** [see docs](https://www.npmjs.com/package/validall)
nats        | string \| number \| NatsConnectionOptions | null        | see [Nats Docs](https://docs.nats.io/)
exitOnUnhandledException | boolean | true |
socket | SocketIOOptions | null |
auth | AuthOptions | null |

#### LOGLEVEL Enum

**PMS** provides only four levels of logs grouped in an enum type **LOGLEVEL**

- LOGLEVEL.ERROR
- LOGLEVEL.WARN
- LOGLEVEL.INFO
- LOGLEVEL.DEBUG

**PMS** has a built in lightweight logger that logs everything to the console.

In order to change that behavior we can define a log method in our service and **PMS** will detect that method and will transfer all logs to it;

```ts
import { SERVICE } from '@pestras/microservice';

@SERVICE({ version: 1 })
class Test {

  log(level: LOGLEVEL, msg: any, extra: any) {

  }
}
```

### SocketIOOptions

Name | Type | default | Description
--- | --- | --- | ---
serverOptions | SocketIO.ServerOptions | null | see [socket.io docs](https://socket.io/docs/server-api/)
maxListeners  | number  | 10 |

### AuthOptions

Name | Type | default
--- | --- | ---
endpoint | string | null
subject | string | null
timeout | number | 15000

When defined **PMS** will use these options when authorizing routes, subjects and socketIO connection, if both *endpoint* and *subject* are defined **PMS** will use *endpoint*.

*endpoint* option is a REST service url that will be called with post method sending additional data in the request body **AuthPayload**.

Name | Type | Description
--- | --- | ---
service | string | Service name *class constructor name*
name | string | Route name, nats subject or socket namespace. 
payload | { params: Object, query, Object, body: Object }

In case of authorizing routes, incoming request params, query and body will be sent in the payload object of auth request, and in case of nats subjects msg data will be sent in *payload.body* only.

Each auth request will send auth token in **Authorization** header, it will get it from **Authorization** header in case of route request, and nats subject *msg.data.authoraization*, and for socket.io *socket.handshake.query.auth*

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

## ROUTE DECORATOR

Used to define a route for a rest service.

**ROUTE** accepts an optional config objects to configure our route.

Name | type | Default | Description
--- | --- | --- | --- | --- 
name | string | Method name applied to | name of the route
path | string | '' | Service path pattern very similar to express route path
method | HttpMethod | 'GET' | 
requestType | string | 'application/json | Same as 'Content-Type' header
body | ISchema | null | Validall Schema see [validall docs](https://www.npmjs.com/package/validall)
bodyQuota | number | 1024 * 100 | Request body size limit
query | ISchema | null | Validall Schema see [validall docs](https://www.npmjs.com/package/validall)
queryLength | number | 100 | Request query characters length limit
auth | boolean | false | Sets the current route as secure and needs authorization
timeout | number | 15000 | Max time for to handle the request before canceling

```ts
import { SERVICE, ROUTE } from '@pestras/microservice';

@SERVICE({
  version: 1,
  port: 3333
})
class Article {

  @ROUTE({
    path: '/:id'
  })
  getArticle(req: Request, res: Response) {
    let id = req.params.id;

    // get artcle code

    res.json(article);
  }

  @ROUTE({
    method: 'POST',
    auth: true, // if authorization passed request.user will hold user data
    body: {
      $filter: true,
      $props:
        name: { $type: 'string' },
        body: { $type: 'string' }
    }
  })
  insertArticle(req: Request, res: Response) {
    let user = req.user;
    let article = req.body;

    // insert article

    res.json({ id: artcle.id });
  }
}
```

### Request

*PMS** http request extends Node IncomingMessage class with few additional properties*

Name | Type | Description
--- | --- | ---
url | URL | URL extends Node URL class with some few properties, most used one is *query*.
params | { [key: string]: string } | includes route path params values.
body | any |
user | any | When auth option is set to true.
auth | string | Auth token from Authorization header.
get | (key: string) => string | method to get specific request header value

### Response

*PMS** http response extends Node Response class with a couple of methods.

Name | Type | Description
--- | --- | ---
json | (data?: any) => void | Used to send json data.
status | (code: number) => Response | Used to set response status code.

**Response** will log any 500 family errors automatically.

## SUBJECT DECORATOR

Used to subscribe to nats server pulished subjects, and also accepts a config object.

Name | Type | Required | Default | Description
--- | --- | ---
subject | string | true | - | Nats server subject pattern
body | ISchema | false | null | Validall Schema see [validall docs](https://www.npmjs.com/package/validall)
bodyQuota | number | false | 1024 * 100 | Subject msg data size limit
payload | NatsPayload | false | Payload.JSON | see [Nats Docs](https://docs.nats.io/)
options | SubscriptionOptions | false | null | see [Nats Docs](https://docs.nats.io/)
auth | boolean | false | false | Sets the current Subject as secure and needs authorization

```ts
import { SERVICE, SUBJECT } from '@pestras/microservice';

@SERVICE({
  version: 1,
  port: 3334,
  workers: 4
})
class Email {

  @SUBJECT({
    name: 'user.insert',
    auht: true, // if authorization passed msg.data.user will hold user data
    body: {
      $props: {
        user: { $type: 'object' } // since we know user data will be provided after authorization
      }
    },
    options: { queue: 'emailServiceWorker' }
  })
  sendActivationEmail(nats: NatsClient, msg: Msg) {
    let id = msg.data;
    let user = msg.data.user
  }
```

# SocketIO

**PMS** provides us with several decoratoes to manage our SocketIO server.

## CONNECT DECORATOR

This decorator wiil call the method attached to whenever a new socket has connected,
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

And for the second parameter a boolean value to determine weather authorization is enabled or not,
if set to true **PMS** will get the value of *socket.handshake.query.auth* as a token and authorizes it.

```ts
import { SERVICE, HANDSHAKE } from '@pestras/microservice';

@SERVICE()
class Publisher {

  @HANDSHAKE()
  handshake(io: SocketIO.Servier, socket: SocketIO.Socket, next: (err?: any) => void) {}

  @HANDSHAKE(['blog'], true) // if authorization passed socket.user will hold user data
  blogHandshake(ns: SocketIO.Namespace, socket: SocketIO.Socket, next: (err?: any) => void) {
    let user = socket.user;
  }
}
```

## USE DECORATOE

Same as **HANDSHAKE** decorator, however no authorization supported

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

  @EVENT(['newArticle', 'blog'])
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

**PMS** makes use of node built in cluster api and made it easy for us to manage workers communications.

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
target | 'all' | 'others' | false | 'others' | If we need the same worker to receive the message as well.

```ts
import { SERVICE, Micro } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {
  
  // some where in your service
  Micro.message('some message', { key: 'value' });
}
```

**PMS** provide us another helper method to manage communications between workers for handling socket io broadcasting using *Micro.publish* method which accepts SocketIOPublishMessage object.

Name | Type | Required | Default | Description
--- | --- | ---- | --- | ---
event | string | true | - | Event name that needs to be published
data | any[] | true | - | event payload array distructed on multipe arguments
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
    Micro.publish({
      event: 'ArticleUpdated',
      data: id,
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

# Lifecycle & Events Methods

**PMS** will try to call some service methods in specific time or action if they were already defined in our service.

## Lifecycle Methods

### onInit

When defined, will be called one our service is instantiated but nothing else, this method is useful when
we need to connect to a databese or do some async operations before start listening one events or http requests.

It can return a promise or nothing.

```ts
import { SERVICE } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {

  async onInit() {
    // connect to a databese
    return;
  }
}
```

## onReady

This Method is called once all our listeners are ready.

```ts
import { SERVICE } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {

  async onReay() {}
}
```

## onDestory

Called once our service is stopped for any reason, and the exit signal is passed as an argument.

```ts
@SERVICE({ workers: 4 })
class Publisher {

  async onDestory(signal: NodeJS.Signals) {
    // disconnecting from the databese
  }
}
```

## Events Methods

Events methods will be called when some specific actions happens..

### onRequest

Called whenever a new http request is received, passing the Request and Response instances as arguments, it can return a promise or nothing;

```ts
@SERVICE({ workers: 4 })
class Publisher {

  async onRequest(req: Request, res: Response) { }
}
```

This event method is called before authorizing the request or even before checking if there is a matched route or not.

### onError

Called whenever an error accured when handling an http request, passing the Request and Response instances and the error as arguments.

```ts
@SERVICE({ workers: 4 })
class Publisher {

  async onError(req: Request, res: Response, err: any) { }
}
```

### onUnhandledRejection

I think it is clear by only reading the name.

```ts
@SERVICE({ workers: 4 })
class Publisher {

  async onUnhandledRejection(reason: any, p: Promise<any>) { }
}
```

### onUnhandledException

Also clear.

```ts
@SERVICE({ workers: 4 })
class Publisher {

  async onUnhandledException(err: any) { }
}
```

Thank you