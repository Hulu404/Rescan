// Customer data of the consignment order header. The repository is public, so it lives in the environment only.
const VARIABLES = {
  name: 'CUSTOMER_NAME',
  email: 'CUSTOMER_EMAIL',
  city: 'CUSTOMER_CITY',
  soldTo: 'CUSTOMER_SOLD_TO',
  shipTo: 'CUSTOMER_SHIP_TO',
};

const read = (env, variable) => String(env[variable] ?? '').trim();

/** @returns {{name:string, email:string, city:string, soldTo:string, shipTo:string}} unset fields are '' */
export function readCustomer(env = process.env) {
  return Object.fromEntries(Object.entries(VARIABLES).map(([field, variable]) => [field, read(env, variable)]));
}

/** @returns {string[]} names of unset variables: their header cells stay blank */
export function missingCustomerFields(env = process.env) {
  return Object.values(VARIABLES).filter(variable => !read(env, variable));
}
