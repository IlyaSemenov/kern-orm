# Phase of a connection failure watched on every statement

A transaction of `transaction` watches every statement and script on its connection, including those of its nested levels, through a wrapper of its reserved connection, which records the first `ConnectionError` with the phase of the transaction when its rejection comes.
After such an error before `COMMIT` is sent, the transaction rolls back instead of `COMMIT`, also when the callback caught the error, and a transaction that rejects after such an error rejects with `TransactionConnectionError` of that phase.

```ts
await db.$transaction(async () => {
  try {
    await db.form.insert({ name: "Survey", published: false })
  } catch {
    // A ConnectionError leaves unknown whether the insert ran, so the transaction rolls back
    // and rejects with TransactionConnectionError of phase "transaction" instead of committing.
  }
})
```

The wrapper costs one promise for every statement of a transaction, which `.catch` of the promise of the driver creates; its handler is one function of the transaction, so a statement allocates no closure.

## The driver reports the failure

A driver could keep a flag on its `Connection` of whether a statement failed with `ConnectionError`, which the coordinator reads before `COMMIT`, without a promise for every statement.
It extends the contract that every driver implements, including custom drivers, so every custom driver would need a release that requires the new version of `kern-db`, and the phase would still need the order of the failure and `COMMIT`, which only the coordinator knows.

## The rejection of the callback alone

The coordinator could tell the phase from the error of the callback, as kern-jobs told it from the classes of the errors of its own transaction.
It misses a `ConnectionError` that the callback caught, after which the transaction would commit without the statement, and one of a nested level that its enclosing callback caught.

## The phase when the statement was sent

Taking the phase when a statement is sent tells a statement of the callback from `COMMIT`, but a client that pipelines statements, such as postgres.js, may have sent a later `COMMIT` before the connection broke, and then rejects every statement it queued.
The rejection of a statement that the callback did not await would then give `transaction`, while the server may have committed, so the phase is the one when the rejection comes, which gives `commit` once `COMMIT` is sent.
