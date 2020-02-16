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
nats        | string \| number \| NatsConnectionOptions | null        | see [Nats Docs](https://docs.nats.io/)
exitOnUnhandledException | boolean | true |
socket | SocketIOOptions | null |
authTimeout | number | 15000 | auth method timeout

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

**ROUTE** accepts an optional config object to configure our route.

Name | type | Default | Description
--- | --- | --- | --- 
name | string | Method name applied to | name of the route
path | string | '' | Service path pattern very similar to express route path
method | HttpMethod | 'GET' | 
requestType | string | 'application/json | Same as 'Content-Type' header
body | (routeName: string, body: any) => any \| Promise\<any\> | null | validation method
bodyQuota | number | 1024 * 100 | Request body size limit
query | (routeName: string, query: any) => any \| Promise\<any\> | null | validation method
queryLength | number | 100 | Request query characters length limit
auth | (routeName: string, request: Request) => any \| Promise\<any\> | null | auth method
timeout | number | 15000 | Max time to handle the request before canceling

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
    auth: async (routName: string, request: Request) => {
      //  some authorization
    }
  })
  insertArticle(req: Request, res: Response) {
    let auth = req.auth;
    let article = req.body;

    // insert article

    res.json({ id: artcle.id });
  }
}
```

*Note: All validation and auth methods should return or resolve to null when passed, returned or resolved values are consedered as validation or auth failure*

### Request

*PMS** http request holds the original Node IncomingMessage with a few extra properties*

Name | Type | Description
--- | --- | ---
url | URL | URL extends Node URL class with some few properties, most used one is *query*.
params | { [key: string]: string } | includes route path params values.
body | any |
auth | any | useful to save some auth value.
get | (key: string) => string | method to get specific request header value
http | NodeJS.IncomingMessage | 

### Response

*PMS** http response holds the original Node Server Response with a couple of methods.

Name | Type | Description
--- | --- | ---
json | (data?: any) => void | Used to send json data.
status | (code: number) => Response | Used to set response status code.
end | any | Overwrites orignal end method *recommended to use*
http | NodeJS.ServerResponse | 

**Response** will log any 500 family errors automatically.

## SUBJECT DECORATOR

Used to subscribe to nats server pulished subjects, and also accepts a config object.

Name | Type | Required | Default | Description
--- | --- | --- | --- | ---
subject | string | true | - | Nats server subject pattern
data | (data: any) => any \| Promise\<any\> | null | validation method
dataQuota | number | false | 1024 * 100 | Subject msg data size limit
payload | NatsPayload | false | Payload.JSON | see [Nats Docs](https://docs.nats.io/)
options | SubscriptionOptions | false | null | see [Nats Docs](https://docs.nats.io/)
auth | (routName: string, request: Request) => any \| Promise\<any\> | false | null | auth method

```ts
import { SERVICE, SUBJECT } from '@pestras/microservice';

@SERVICE({
  version: 1,
  port: 3334,
  workers: 4
})
class Email {

  @SUBJECT({
    subject: 'user.insert',
    auth: async (subject: string, msg: Msg) => {
      //  some authorization
    },
    options: { queue: 'emailServiceWorker' }
  })
  sendActivationEmail(nats: NatsClient, msg: Msg) {
    let auth = msg.data.auth;
  }
```

*Note: Both validation and auth methods should return or resolve to null when passed, returned or resolved values are consedered as validation or auth failure*

*Note: Incase of validation or auth failer, **PMS** will automatically reply if msg has reply subject*

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

The second parameter is for auth helper.

```ts
import { SERVICE, HANDSHAKE } from '@pestras/microservice';

@SERVICE()
class Publisher {

  @HANDSHAKE()
  handshake(io: SocketIO.Servier, socket: SocketIO.Socket, next: (err?: any) => void) {}

  @HANDSHAKE(
    ['blog'],
    async (ns: SocketIO.Namespace, socket: SocketIO.Socket) => {
      //  some authorization
    }
  )
  blogHandshake(ns: SocketIO.Namespace, socket: SocketIO.Socket, next: (err?: any) => void) {
    let auth = socket.auth;
  }
}
```
*Note: Auth method should return or resolve to null when passed, returned or resolved value is consedered as failure*

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

When defined, will be called once our service is instantiated but nothing else, this method is useful when
we need to connect to a databese or to make some async operations before start listening one events or http requests.

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

This method is called once all our listeners are ready.

```ts
import { SERVICE } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {

  onReay() {}
}
```

## onDestory

Called once our service is stopped for any reason, and the exit signal is passed as an argument.

```ts
@SERVICE({ workers: 4 })
class Publisher {

  onDestory(signal: NodeJS.Signals) {
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

  onError(req: Request, res: Response, err: any) { }
}
```

### onUnhandledRejection

I think it is clear by only reading the name.

```ts
@SERVICE({ workers: 4 })
class Publisher {

  onUnhandledRejection(reason: any, p: Promise<any>) { }
}
```

### onUnhandledException

Also clear.

```ts
@SERVICE({ workers: 4 })
class Publisher {

  onUnhandledException(err: any) { }
}
```

Thank you