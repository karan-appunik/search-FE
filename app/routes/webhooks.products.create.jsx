// products/create needs the exact same handling as products/update
// (fetch the current product, upsert it) — reusing that action
// directly instead of duplicating it, so the two can never drift
// apart.
export { action } from "./webhooks.products.update";
