import { requireEnv } from '@/lib/env';

/**
 * BUSINESSKORO STOREFRONT API
 *
 * The only place in the app that knows BusinessKoro's wire format. Everything
 * else depends on the shapes below, so if BusinessKoro changes a field name
 * this is the only file that has to change.
 */

/** Verified storefront base URL. `SUPPLIER_API_BASE_URL` overrides it (sandbox). */
const BUSINESSKORO_BASE_URL = 'https://api.businesskoro.com/api/v1/storefront';

/**
 * ---------------------------------------------------------------------------
 * REPLACE BEFORE GOING LIVE
 * ---------------------------------------------------------------------------
 * The productId of the "5 in 1 Gaming Combo" in your BusinessKoro dashboard.
 * The storefront order endpoint takes one productId per order, so every order
 * placed by the bot uses this single value.
 */
const BUSINESSKORO_PRODUCT_ID = '5-in-1-gaming-combo-pack';

/**
 * The only price band the bot may ever commit to (see STORE_CONTEXT in
 * src/lib/ai/agent1-support.ts: 1550 offer, 1500 absolute floor).
 *
 * `sellingPrice` is composed by Gemini, and a hallucinated number here is a
 * direct financial loss — the supplier would ship at that price, or the
 * customer would be charged more than they agreed to. The prompt asks the model
 * to stay in range; this enforces it, because a prompt is not a guarantee.
 */
const MIN_SELLING_PRICE = 1500;
const MAX_SELLING_PRICE = 1550;

export interface SupplierOrderItem {
  name: string;
  sku?: string;
  qty: number;
  price: number;
}

export interface SupplierOrderRequest {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  items: SupplierOrderItem[];
  notes?: string;
}

export interface SupplierOrderResult {
  supplierOrderId: string | null;
  raw: unknown;
}

/** Thrown for non-2xx responses so callers can record status 'failed'. */
export class SupplierApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Supplier API rejected the order (HTTP ${status})`);
    this.name = 'SupplierApiError';
    this.status = status;
    this.body = body;
  }
}

export async function createSupplierOrder(
  request: SupplierOrderRequest,
): Promise<SupplierOrderResult> {
  // Tolerate a trailing slash in the env var.
  const baseUrl = (
    process.env.SUPPLIER_API_BASE_URL?.trim() || BUSINESSKORO_BASE_URL
  ).replace(/\/+$/, '');

  const [item] = request.items;

  // The storefront order endpoint carries a single productId and a single
  // sellingPrice: there is no quantity field and no second line item. Anything
  // else would be sent as one unit at one unit's price, so refuse loudly and
  // let the owner place it by hand instead of under-charging unnoticed.
  if (request.items.length !== 1 || item.qty !== 1) {
    throw new Error(
      'BusinessKoro accepts one unit of one product per order, but this order has ' +
        `${request.items.length} line item(s) totalling ${request.items.reduce(
          (units, line) => units + line.qty,
          0,
        )} unit(s). Place it manually.`,
    );
  }

  const sellingPrice = clampSellingPrice(item.price);
  const { division, district } = resolveDivisionAndDistrict(
    request.customerAddress,
  );

  const response = await fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // BusinessKoro authenticates with x-api-key, NOT a Bearer token.
      'x-api-key': requireEnv('SUPPLIER_API_KEY'),
    },
    body: JSON.stringify({
      productId: BUSINESSKORO_PRODUCT_ID,
      customerName: request.customerName,
      customerPhone: request.customerPhone,
      customerAddress: request.customerAddress,
      // Read back out of the free-text address the bot collected, so an order
      // from Chattogram is not filed under Dhaka. Unrecognised addresses still
      // fall back to Dhaka, and the courier reads customerAddress regardless.
      customerDivision: division,
      customerDistrict: district,
      customerArea: 'N/A',
      // The agreed product price only. The delivery charge is collected by the
      // courier on top of this, hence the flag below.
      sellingPrice,
      deliveryChargePaidByCustomer: true,
      customerNote: request.notes || '',
    }),
    cache: 'no-store',
  });

  const raw: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new SupplierApiError(response.status, raw);
  }

  return { supplierOrderId: extractOrderId(raw), raw };
}

/** BusinessKoro returns the created order under `data.id`. */
function extractOrderId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;

  const record = raw as { id?: unknown; data?: { id?: unknown } | null };
  const candidate = record.data?.id ?? record.id;

  return candidate === undefined || candidate === null ? null : String(candidate);
}

/**
 * Holds `sellingPrice` inside the only band the business allows.
 *
 * A non-finite price (NaN, Infinity) is a bug in the caller rather than a
 * bargain, so it falls back to the offer price instead of being sent as an
 * unparseable number.
 */
function clampSellingPrice(price: number): number {
  if (!Number.isFinite(price)) {
    console.warn('[supplier] sellingPrice is not a finite number, using the offer price', {
      price,
    });
    return MAX_SELLING_PRICE;
  }

  const clamped = Math.min(MAX_SELLING_PRICE, Math.max(MIN_SELLING_PRICE, price));

  if (clamped !== price) {
    console.warn('[supplier] sellingPrice out of range, clamped', {
      price,
      clamped,
    });
  }

  return clamped;
}

type Division =
  | 'Dhaka'
  | 'Chattogram'
  | 'Rajshahi'
  | 'Khulna'
  | 'Barishal'
  | 'Sylhet'
  | 'Rangpur'
  | 'Mymensingh';

interface DistrictEntry {
  /** Canonical English name — this is exactly what BusinessKoro receives. */
  district: string;
  division: Division;
  /** Alternate spellings and the Bangla script name customers type. */
  aliases: readonly string[];
}

/** All 64 districts, grouped by the division they belong to. */
const DISTRICTS: readonly DistrictEntry[] = [
  // Dhaka
  { district: 'Dhaka', division: 'Dhaka', aliases: ['ঢাকা', 'dacca'] },
  { district: 'Faridpur', division: 'Dhaka', aliases: ['ফরিদপুর'] },
  { district: 'Gazipur', division: 'Dhaka', aliases: ['গাজীপুর'] },
  { district: 'Gopalganj', division: 'Dhaka', aliases: ['গোপালগঞ্জ'] },
  { district: 'Kishoreganj', division: 'Dhaka', aliases: ['কিশোরগঞ্জ'] },
  { district: 'Madaripur', division: 'Dhaka', aliases: ['মাদারীপুর'] },
  { district: 'Manikganj', division: 'Dhaka', aliases: ['মানিকগঞ্জ'] },
  { district: 'Munshiganj', division: 'Dhaka', aliases: ['মুন্সিগঞ্জ'] },
  { district: 'Narayanganj', division: 'Dhaka', aliases: ['নারায়ণগঞ্জ'] },
  { district: 'Narsingdi', division: 'Dhaka', aliases: ['নরসিংদী'] },
  { district: 'Rajbari', division: 'Dhaka', aliases: ['রাজবাড়ী'] },
  { district: 'Shariatpur', division: 'Dhaka', aliases: ['শরীয়তপুর'] },
  { district: 'Tangail', division: 'Dhaka', aliases: ['টাঙ্গাইল'] },

  // Chattogram
  { district: 'Bandarban', division: 'Chattogram', aliases: ['বান্দরবান'] },
  { district: 'Brahmanbaria', division: 'Chattogram', aliases: ['ব্রাহ্মণবাড়িয়া'] },
  { district: 'Chandpur', division: 'Chattogram', aliases: ['চাঁদপুর'] },
  {
    district: 'Chattogram',
    division: 'Chattogram',
    aliases: ['চট্টগ্রাম', 'chittagong', 'চিটাগাং'],
  },
  { district: 'Cumilla', division: 'Chattogram', aliases: ['কুমিল্লা', 'comilla'] },
  {
    district: "Cox's Bazar",
    division: 'Chattogram',
    aliases: ['কক্সবাজার', 'coxs bazar'],
  },
  { district: 'Feni', division: 'Chattogram', aliases: ['ফেনী'] },
  {
    district: 'Khagrachhari',
    division: 'Chattogram',
    aliases: ['খাগড়াছড়ি', 'khagrachari'],
  },
  {
    district: 'Lakshmipur',
    division: 'Chattogram',
    aliases: ['লক্ষ্মীপুর', 'laxmipur'],
  },
  { district: 'Noakhali', division: 'Chattogram', aliases: ['নোয়াখালী'] },
  { district: 'Rangamati', division: 'Chattogram', aliases: ['রাঙ্গামাটি'] },

  // Rajshahi
  { district: 'Bogura', division: 'Rajshahi', aliases: ['বগুড়া', 'bogra'] },
  {
    district: 'Chapainawabganj',
    division: 'Rajshahi',
    aliases: ['চাঁপাইনবাবগঞ্জ', 'chapai nawabganj', 'nawabganj'],
  },
  {
    district: 'Joypurhat',
    division: 'Rajshahi',
    aliases: ['জয়পুরহাট', 'jaipurhat'],
  },
  { district: 'Naogaon', division: 'Rajshahi', aliases: ['নওগাঁ'] },
  { district: 'Natore', division: 'Rajshahi', aliases: ['নাটোর'] },
  { district: 'Pabna', division: 'Rajshahi', aliases: ['পাবনা'] },
  { district: 'Rajshahi', division: 'Rajshahi', aliases: ['রাজশাহী'] },
  { district: 'Sirajganj', division: 'Rajshahi', aliases: ['সিরাজগঞ্জ'] },

  // Khulna
  { district: 'Bagerhat', division: 'Khulna', aliases: ['বাগেরহাট'] },
  { district: 'Chuadanga', division: 'Khulna', aliases: ['চুয়াডাঙ্গা'] },
  { district: 'Jashore', division: 'Khulna', aliases: ['যশোর', 'jessore'] },
  { district: 'Jhenaidah', division: 'Khulna', aliases: ['ঝিনাইদহ', 'jhenidah'] },
  { district: 'Khulna', division: 'Khulna', aliases: ['খুলনা'] },
  { district: 'Kushtia', division: 'Khulna', aliases: ['কুষ্টিয়া'] },
  { district: 'Magura', division: 'Khulna', aliases: ['মাগুরা'] },
  { district: 'Meherpur', division: 'Khulna', aliases: ['মেহেরপুর'] },
  { district: 'Narail', division: 'Khulna', aliases: ['নড়াইল'] },
  { district: 'Satkhira', division: 'Khulna', aliases: ['সাতক্ষীরা'] },

  // Barishal
  { district: 'Barguna', division: 'Barishal', aliases: ['বরগুনা'] },
  { district: 'Barishal', division: 'Barishal', aliases: ['বরিশাল', 'barisal'] },
  { district: 'Bhola', division: 'Barishal', aliases: ['ভোলা'] },
  {
    district: 'Jhalokati',
    division: 'Barishal',
    aliases: ['ঝালকাঠি', 'jhalakathi'],
  },
  { district: 'Patuakhali', division: 'Barishal', aliases: ['পটুয়াখালী'] },
  { district: 'Pirojpur', division: 'Barishal', aliases: ['পিরোজপুর'] },

  // Sylhet
  { district: 'Habiganj', division: 'Sylhet', aliases: ['হবিগঞ্জ'] },
  {
    district: 'Moulvibazar',
    division: 'Sylhet',
    aliases: ['মৌলভীবাজার', 'maulvibazar'],
  },
  { district: 'Sunamganj', division: 'Sylhet', aliases: ['সুনামগঞ্জ'] },
  { district: 'Sylhet', division: 'Sylhet', aliases: ['সিলেট'] },

  // Rangpur
  { district: 'Dinajpur', division: 'Rangpur', aliases: ['দিনাজপুর'] },
  { district: 'Gaibandha', division: 'Rangpur', aliases: ['গাইবান্ধা'] },
  { district: 'Kurigram', division: 'Rangpur', aliases: ['কুড়িগ্রাম'] },
  { district: 'Lalmonirhat', division: 'Rangpur', aliases: ['লালমনিরহাট'] },
  { district: 'Nilphamari', division: 'Rangpur', aliases: ['নীলফামারী'] },
  { district: 'Panchagarh', division: 'Rangpur', aliases: ['পঞ্চগড়'] },
  { district: 'Rangpur', division: 'Rangpur', aliases: ['রংপুর'] },
  { district: 'Thakurgaon', division: 'Rangpur', aliases: ['ঠাকুরগাঁও'] },

  // Mymensingh
  { district: 'Jamalpur', division: 'Mymensingh', aliases: ['জামালপুর'] },
  { district: 'Mymensingh', division: 'Mymensingh', aliases: ['ময়মনসিংহ'] },
  { district: 'Netrokona', division: 'Mymensingh', aliases: ['নেত্রকোণা', 'netrakona'] },
  { district: 'Sherpur', division: 'Mymensingh', aliases: ['শেরপুর'] },
];

const DEFAULT_DIVISION: Division = 'Dhaka';
const DEFAULT_DISTRICT = 'Dhaka';

interface DistrictMatch {
  /** The normalised name to look for inside a normalised address. */
  match: string;
  district: string;
  division: Division;
  /** True when this district shares its name with the division it sits in. */
  divisionCapital: boolean;
}

/**
 * Every district name flattened into one list, most specific first.
 *
 * The ordering decides which name wins when an address contains two of them:
 *   - "Cox's Bazar, Chittagong" is written district-then-division, and the
 *     district is the answer, so districts that name a division are ranked
 *     last: Chattogram would be wrong there and right in "Chattogram, Feni".
 *   - "ঢাকার বাইরে, চট্টগ্রাম" names two divisions, so the longer name wins.
 *   - Within a group, longest-first also stops a short name from being matched
 *     inside a longer one ("chapainawabganj" before "nawabganj").
 */
const DISTRICT_LOOKUP: readonly DistrictMatch[] = DISTRICTS.flatMap((entry) =>
  [entry.district, ...entry.aliases].map((name) => ({
    match: normalizeAddress(name),
    district: entry.district,
    division: entry.division,
    // Dhaka, Chattogram, Rajshahi, Khulna, Barishal, Sylhet, Rangpur and
    // Mymensingh each name both a district and the division around it.
    divisionCapital: entry.district === entry.division,
  })),
).sort((a, b) => {
  if (a.divisionCapital !== b.divisionCapital) return a.divisionCapital ? 1 : -1;
  return b.match.length - a.match.length;
});

/**
 * Lower-cases and drops every separator, so "Cox's Bazar", "coxs bazar" and
 * "কক্সবাজার" all become comparable substrings.
 *
 * The Bangla block (U+0980–U+09FF) is kept explicitly rather than using a
 * Unicode property escape, which needs an ES2018 build target.
 */
function normalizeAddress(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u0980-\u09ff]+/g, '');
}

/**
 * Reads the division and district back out of the free-text address the bot
 * collected — BusinessKoro wants the pair, but the customer only ever gives one
 * line of text.
 *
 * Defaults to Dhaka when no district is recognisable, which is what the
 * hardcoded version always sent.
 */
export function resolveDivisionAndDistrict(address: string): {
  division: Division;
  district: string;
} {
  const haystack = normalizeAddress(address ?? '');

  if (haystack) {
    for (const entry of DISTRICT_LOOKUP) {
      if (haystack.includes(entry.match)) {
        return { division: entry.division, district: entry.district };
      }
    }
  }

  return { division: DEFAULT_DIVISION, district: DEFAULT_DISTRICT };
}
