/** Tells whether `T` is `any`: only `any` turns `1 & T` into a type that `0` extends. */
export type IsAny<T> = 0 extends 1 & T ? true : false

/** Flattens an intersection of object types into one object type, so that editors show its fields; `any` stays `any`. */
export type Simplify<T> = IsAny<T> extends true ? T : { [K in keyof T]: T[K] } & {}

/** Tells whether `T` is a union of several types. */
export type IsUnion<T, Whole = T> = T extends unknown ? ([Whole] extends [T] ? false : true) : false
