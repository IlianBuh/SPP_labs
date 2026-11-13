import 'dotenv/config';
const response = await fetch(`http://127.0.0.1:${process.env.PORT || 4000}/graphql`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.ADMIN_TOKEN ? { authorization: `Bearer ${process.env.ADMIN_TOKEN}` } : {}) },
  body: JSON.stringify({ query: 'mutation StartImport($target: Int!) { startImport(target: $target) { id status target progress { sourceId fetched done } } }', variables: { target: Number(process.argv[2] || process.env.IMPORT_TARGET || 10500) } })
});
const result = await response.json();
console.log(JSON.stringify(result, null, 2));
if (!response.ok || result.errors) process.exitCode = 1;
