import { pool, withTx } from '../db/pool.js';
import * as products from '../db/products.js';
import { insertTransaction } from '../db/transactions.js';
import { getSystemCategory } from '../db/categories.js';
import { changedFields, writeAudit } from '../db/audit.js';
import { conflict, fieldError, notFound, rethrowUnique, unprocessable } from '../lib/errors.js';
import { lineAmount } from '../lib/money.js';
import { todayJakarta } from '../lib/dates.js';
import { requireActiveAccount } from './accounts.js';

const UNIQUE_MESSAGES = {
  products_business_id_name_key: { field: 'name', message: 'Nama produk sudah dipakai.' },
  products_unique_sku: { field: 'sku', message: 'SKU sudah dipakai.' },
};
const BELOW_ZERO = 'Stok tidak boleh kurang dari 0.';

/** BR-011: Staff never receive cost price or margin. */
export function productForRole(product, role) {
  if (role === 'staff') {
    const visible = { ...product };
    delete visible.cost_price;
    return visible;
  }
  return { ...product, margin: product.sell_price - product.cost_price };
}

export async function listProducts(actor, filters) {
  const { items, total } = await products.listProducts(pool, actor.business_id, filters);
  return { items: items.map((p) => productForRole(p, actor.role)), total };
}

async function requireProduct(q, businessId, productId) {
  const product = await products.getProduct(q, businessId, productId);
  if (!product) throw notFound('Produk tidak ditemukan.');
  return product;
}

export async function getProduct(actor, productId) {
  return productForRole(await requireProduct(pool, actor.business_id, productId), actor.role);
}

export async function createProduct(actor, body) {
  if (!body.track_stock && body.opening_stock > 0) {
    throw fieldError('opening_stock', 'Stok awal hanya untuk produk yang stoknya dilacak.');
  }
  try {
    return await withTx(async (client) => {
      const id = await products.insertProduct(client, actor.business_id, body);
      if (body.track_stock && body.opening_stock > 0) {
        await products.writeStockMovement(client, {
          businessId: actor.business_id,
          productId: id,
          type: 'opening',
          qty: body.opening_stock,
          userId: actor.id,
        });
      }
      await writeAudit(client, {
        businessId: actor.business_id,
        userId: actor.id,
        action: 'create',
        entityType: 'product',
        entityId: id,
        detail: { name: body.name, sell_price: body.sell_price, cost_price: body.cost_price },
      });
      return productForRole(await requireProduct(client, actor.business_id, id), actor.role);
    });
  } catch (error) {
    return rethrowUnique(error, UNIQUE_MESSAGES);
  }
}

export async function updateProduct(actor, productId, body) {
  try {
    return await withTx(async (client) => {
      const before = await requireProduct(client, actor.business_id, productId);
      const next = { ...before, ...body };
      await products.updateProduct(client, actor.business_id, productId, next);
      await writeAudit(client, {
        businessId: actor.business_id,
        userId: actor.id,
        action: 'update',
        entityType: 'product',
        entityId: productId,
        detail: changedFields(before, body),
      });
      return productForRole(await requireProduct(client, actor.business_id, productId), actor.role);
    });
  } catch (error) {
    return rethrowUnique(error, UNIQUE_MESSAGES);
  }
}

async function restockExpense(client, actor, product, body) {
  const account = await requireActiveAccount(client, actor.business_id, body.account_id);
  const category = await getSystemCategory(client, actor.business_id, 'inventory');
  const costPrice = body.cost_price ?? product.cost_price;
  const amount = lineAmount(body.qty, costPrice);
  if (amount <= 0) throw fieldError('cost_price', 'Isi harga modal untuk mencatat pengeluaran.');
  await insertTransaction(client, {
    businessId: actor.business_id,
    account_id: account.id,
    type: 'expense',
    amount,
    category_id: category.id,
    occurred_on: todayJakarta(),
    note: `Stok masuk ${product.name}`,
    source_type: 'restock',
    source_id: product.id,
    created_by: actor.id,
  });
}

/** Restock (positive qty) or adjustment (signed qty with a reason). */
export async function changeStock(actor, productId, body) {
  return withTx(async (client) => {
    const [product] = await products.lockProducts(client, actor.business_id, [productId]);
    if (!product) throw notFound('Produk tidak ditemukan.');
    if (!product.track_stock) throw conflict('Stok produk ini tidak dilacak.', 'STOCK_NOT_TRACKED');

    const delta = body.kind === 'restock' ? body.qty : body.qty_delta;
    if (Math.round((product.stock_qty + delta) * 1000) < 0) {
      throw unprocessable(BELOW_ZERO, 'NEGATIVE_STOCK');
    }
    await products.writeStockMovement(client, {
      businessId: actor.business_id,
      productId,
      type: body.kind,
      qty: delta,
      reason: body.reason,
      userId: actor.id,
    });
    if (body.kind === 'restock') {
      if (body.cost_price !== undefined && body.cost_price !== product.cost_price) {
        await products.setCostPrice(client, actor.business_id, productId, body.cost_price);
      }
      if (body.record_expense) await restockExpense(client, actor, product, body);
    }
    await writeAudit(client, {
      businessId: actor.business_id,
      userId: actor.id,
      action: 'update',
      entityType: 'stock',
      entityId: productId,
      detail: { kind: body.kind, qty: delta, reason: body.reason ?? null },
    });
    return productForRole(await requireProduct(client, actor.business_id, productId), actor.role);
  });
}

export async function listMovements(actor, productId, query) {
  await requireProduct(pool, actor.business_id, productId);
  return products.listMovements(pool, actor.business_id, productId, query);
}
