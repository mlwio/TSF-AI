const fs = require('fs');
const path = require('path');

/**
 * Utility script to fetch product IDs from BusinessKoro Storefront API.
 * Includes the mandatory 'x-domain' header to avoid 403 Forbidden errors.
 */

async function getProducts() {
  // Try to load API key from .env.local
  let apiKey = process.env.SUPPLIER_API_KEY;
  
  if (!apiKey) {
    try {
      const envPath = path.join(__dirname, '.env.local');
      const envContent = fs.readFileSync(envPath, 'utf8');
      const match = envContent.match(/SUPPLIER_API_KEY=(.*)/);
      if (match) apiKey = match[1].trim();
    } catch (e) {
      console.error('Error: Could not find SUPPLIER_API_KEY in .env.local');
      process.exit(1);
    }
  }

  const DOMAIN = 'tsf-oder.mlwio.com';
  const BASE_URL = 'https://api.businesskoro.com/api/v1/storefront';

  console.log(`Fetching products from ${BASE_URL}...`);
  console.log(`Using domain: ${DOMAIN}`);

  try {
    const response = await fetch(`${BASE_URL}/products`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'x-domain': DOMAIN,
        'Accept': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`Error ${response.status}:`, JSON.stringify(data, null, 2));
      return;
    }

    console.log('\n--- Products Found ---');
    if (data.data && Array.isArray(data.data)) {
      data.data.forEach(p => {
        console.log(`Name: ${p.name}`);
        console.log(`ID:   ${p.id}`);
        console.log(`SKU:  ${p.sku || 'N/A'}`);
        console.log('----------------------');
      });
    } else {
      console.log('No products found in the response.');
      console.log('Raw response:', JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error('Fetch failed:', error.message);
  }
}

getProducts();
