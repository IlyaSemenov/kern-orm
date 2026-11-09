# Error classes of `kern-orm` in drivers

The driver packages reject with `QueryError` and `ConnectionError` of `kern-orm`, and classify the errors of their clients with `toDriverError` of `kern-orm`, which they import at runtime, so that an application catches the errors of any driver with the classes it imports from `kern-orm`:

```ts
import { QueryError } from "kern-orm"
```

The drivers then require `kern-orm` 0.8.0 or later, while they imported only types from `kern-orm` before, and worked with any version of the 0.x series from 0.2.0.
The classes recognize the errors of another copy of `kern-orm` ([decision](error-recognition.md)), so a driver that resolves a copy of its own still throws errors that the application recognizes.

The alternatives:

- Classes of each driver package keep the drivers on types of `kern-orm` alone, and their ranges at the minimum they have, but an application imports the classes of the driver it uses, so code shared by several applications, or by applications on different drivers, depends on the driver, and a library that takes the driver of the application, such as a queue of jobs, cannot tell the errors of a driver it does not know apart.
- A package of the classes alone, which `kern-orm` and the drivers depend on, keeps the drivers off the runtime of `kern-orm`, at the cost of one more package to release and keep compatible, whose copies need the same brand.
