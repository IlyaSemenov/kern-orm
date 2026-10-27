// Schemas and Dbs of the benchmarks of types.
// - A schema of forms of 2 tables, and a tenant schema that includes it and adds answers.
// - A catalog schema of 12 tables, and a store schema that includes it and adds reviews, for the cost of a large schema.

import type { Driver } from "kern-orm"
import { createDatabase, defineSchema, defineTable, many, one } from "kern-orm"
import * as t from "kern-orm/types"

const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
  published: t.boolean,
})
const field = defineTable("field", {
  id: t.uuid.primaryKey(),
  formId: t.uuid,
  position: t.integer,
  label: t.text,
})
const answer = defineTable("answer", {
  id: t.uuid.primaryKey(),
  fieldId: t.uuid,
  value: t.text,
})

export const formsSchema = defineSchema({ form, field }).$relations({
  form: { fields: many(field, { from: "id", to: "formId" }) },
  field: { form: one(form, { from: "formId", to: "id", required: true }) },
})
const tenantSchema = defineSchema(formsSchema, { answer }).$relations({
  field: { answers: many(answer, { from: "id", to: "fieldId" }) },
})

const brand = defineTable("brand", {
  id: t.uuid.primaryKey(),
  name: t.text,
})
const category = defineTable("category", {
  id: t.uuid.primaryKey(),
  parentId: t.uuid.nullable(),
  name: t.text,
})
const supplier = defineTable("supplier", {
  id: t.uuid.primaryKey(),
  name: t.text,
  email: t.text,
})
const product = defineTable("product", {
  id: t.uuid.primaryKey(),
  brandId: t.uuid,
  categoryId: t.uuid,
  supplierId: t.uuid,
  name: t.text,
  description: t.text.nullable(),
})
const variant = defineTable("variant", {
  id: t.uuid.primaryKey(),
  productId: t.uuid,
  sku: t.text.unique(),
  weight: t.integer,
})
const price = defineTable("price", {
  id: t.uuid.primaryKey(),
  variantId: t.uuid,
  currency: t.text,
  amount: t.integer,
})
const warehouse = defineTable("warehouse", {
  id: t.uuid.primaryKey(),
  name: t.text,
  city: t.text,
})
const stock = defineTable("stock", {
  id: t.uuid.primaryKey(),
  variantId: t.uuid,
  warehouseId: t.uuid,
  quantity: t.integer,
})
const customer = defineTable("customer", {
  id: t.uuid.primaryKey(),
  name: t.text,
  email: t.text.unique(),
})
const address = defineTable("address", {
  id: t.uuid.primaryKey(),
  customerId: t.uuid,
  city: t.text,
  street: t.text,
})
const order = defineTable("order", {
  id: t.uuid.primaryKey(),
  customerId: t.uuid,
  addressId: t.uuid,
  placed: t.boolean,
})
const orderLine = defineTable("orderLine", {
  id: t.uuid.primaryKey(),
  orderId: t.uuid,
  variantId: t.uuid,
  quantity: t.integer,
})
const review = defineTable("review", {
  id: t.uuid.primaryKey(),
  productId: t.uuid,
  rating: t.integer,
  text: t.text,
})

export const catalogSchema = defineSchema({
  brand,
  category,
  supplier,
  product,
  variant,
  price,
  warehouse,
  stock,
  customer,
  address,
  order,
  orderLine,
}).$relations({
  brand: { products: many(product, { from: "id", to: "brandId" }) },
  category: {
    parent: one(category, { from: "parentId", to: "id" }),
    products: many(product, { from: "id", to: "categoryId" }),
  },
  supplier: { products: many(product, { from: "id", to: "supplierId" }) },
  product: {
    brand: one(brand, { from: "brandId", to: "id", required: true }),
    category: one(category, { from: "categoryId", to: "id", required: true }),
    supplier: one(supplier, { from: "supplierId", to: "id", required: true }),
    variants: many(variant, { from: "id", to: "productId" }),
  },
  variant: {
    product: one(product, { from: "productId", to: "id", required: true }),
    prices: many(price, { from: "id", to: "variantId" }),
    stocks: many(stock, { from: "id", to: "variantId" }),
  },
  price: { variant: one(variant, { from: "variantId", to: "id", required: true }) },
  warehouse: { stocks: many(stock, { from: "id", to: "warehouseId" }) },
  stock: {
    variant: one(variant, { from: "variantId", to: "id", required: true }),
    warehouse: one(warehouse, { from: "warehouseId", to: "id", required: true }),
  },
  customer: {
    addresses: many(address, { from: "id", to: "customerId" }),
    orders: many(order, { from: "id", to: "customerId" }),
  },
  address: { customer: one(customer, { from: "customerId", to: "id", required: true }) },
  order: {
    customer: one(customer, { from: "customerId", to: "id", required: true }),
    address: one(address, { from: "addressId", to: "id", required: true }),
    lines: many(orderLine, { from: "id", to: "orderId" }),
  },
  orderLine: {
    order: one(order, { from: "orderId", to: "id", required: true }),
    variant: one(variant, { from: "variantId", to: "id", required: true }),
  },
})
const storeSchema = defineSchema(catalogSchema, { review }).$relations({
  product: { reviews: many(review, { from: "id", to: "productId" }) },
  review: { product: one(product, { from: "productId", to: "id", required: true }) },
})

// The benchmarks only check the types of queries and never run them.
const database = createDatabase({ driver: {} as Driver })
export const formsDb = database.bind(formsSchema)
export const tenantDb = database.bind(tenantSchema)
export const storeDb = database.bind(storeSchema)
