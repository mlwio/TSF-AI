/**
 * TEMPORARY HELPER — delete once you have the id.
 *
 * Prints every BusinessKoro product as `id  name` so you can copy the id of the
 * "5 in 1 Gaming Combo" into BUSINESSKORO_PRODUCT_ID in src/lib/supplier.ts.
 *
 * Run:  node get-product-id.js
 */

const API_BASE = 'https://api.businesskoro.com/api/v1/storefront';

function loadDotEnvLocal() {
  try {
    // Node >= 20.12. Throws when the file is absent, which is fine: the key may
    // be exported in the shell instead.
    process.loadEnvFile('.env.local');
  } catch {
    // No .env.local — fall through to the ambient environment.
  }
}

async function main() {
  loadDotEnvLocal();

  const apiKey = (process.env.SUPPLIER_API_KEY || '').trim();

  if (!apiKey || apiKey === 'your-businesskoro-api-key') {
    console.error(
      'SUPPLIER_API_KEY is not set.\n\n' +
        'Create .env.local next to this script (copy .env.local.example) and set:\n' +
        '  SUPPLIER_API_KEY=your-real-businesskoro-key\n\n' +
        'Or run it inline without a file:\n' +
        '  SUPPLIER_API_KEY=your-real-key node get-product-id.js',
    );
    process.exit(1);
  }

  const url = `${API_BASE}/products`;
  console.log(`GET ${url}\n`);

  let response;
  try {
    response = await fetch(url, {
      headers: { 'x-api-key': apiKey },
      cache: 'no-store',
    });
  } catch (error) {
    console.error('Request failed:', error.message);
    process.exit(1);
  }

  const text = await response.text();

  if (!response.ok) {
    console.error(`HTTP ${response.status} ${response.statusText}`);
    console.error(text.slice(0, 2000));
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    console.error('Response was not JSON. First 2000 characters:\n');
    console.error(text.slice(0, 2000));
    process.exit(1);
  }

  const products = payload?.data;

  if (!Array.isArray(products)) {
    // Surface the real shape rather than a confusing "0 products".
    console.error('No `data` array in the response. Full response:\n');
    console.error(JSON.stringify(payload, null, 2).slice(0, 2000));
    process.exit(1);
  }

  if (products.length === 0) {
    console.log('The API returned 0 products for this key.');
    return;
  }

  console.log(`${products.length} product(s):\n`);

  for (const product of products) {
    console.log(`${product?.id}\t${product?.name}`);
  }

  console.log(
    '\nCopy the id of the 5 in 1 Gaming Combo into BUSINESSKORO_PRODUCT_ID in src/lib/supplier.ts.',
  );
}

main();
