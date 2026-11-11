# Error classes of `kern-db` in drivers

The drivers reject with `QueryError` and `ConnectionError` of `kern-db`, and classify the errors of their clients with `toDriverError` of `kern-db`, which a custom driver imports at runtime, so that an application catches the errors of any driver with the classes it imports from `kern-db`, or from `kern-orm`, which re-exports them:

```ts
import { QueryError } from "kern-orm"
```

The classes recognize the errors of another copy of `kern-db` ([decision](error-recognition.md)), so a custom driver that resolves a copy of its own still throws errors that the application recognizes.

The alternatives:

- Classes of each driver keep a custom driver on types of `kern-db` alone, but an application imports the classes of the driver it uses, so code shared by several applications, or by applications on different drivers, depends on the driver, and a library that takes the driver of the application, such as a queue of jobs, cannot tell the errors of a driver it does not know apart.
- A package of the classes alone, which `kern-db` and custom drivers depend on, keeps custom drivers off the runtime of `kern-db`, at the cost of one more package to release and keep compatible, whose copies need the same brand.
