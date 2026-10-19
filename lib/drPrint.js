import { printDocument, dateFmt, phpFmt } from '@/lib/print';
import { priceLines } from '@/lib/drPricing';

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Prints a delivery receipt (A4 letterhead, items, three signature lines). Prices and
// totals come from the linked invoice (or the item's selling price); pass
// { showPrices: false } for a receipt without them.
export async function printDr(dr, { showPrices = true } = {}) {
  const priced = priceLines(dr);
  const withPrices = showPrices && priced.hasPrices;
  const dash = '<span class="gray">—</span>';
  const rows = priced.lines.map((l, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${esc(l.description)}</td>
      <td class="right">${Number(l.quantity).toLocaleString('en-PH')}</td>
      <td>${esc(l.unit || '')}</td>
      ${withPrices ? `<td class="right">${l.unitPrice == null ? dash : phpFmt(l.unitPrice)}</td><td class="right">${l.amount == null ? dash : phpFmt(l.amount)}</td>` : ''}
    </tr>`).join('');
  const totals = withPrices ? `
    <div style="max-width:300px;margin-left:auto;margin-top:8px;">
      <div class="totals-row"><span class="gray">Subtotal</span><span class="mono">${phpFmt(priced.subtotal)}</span></div>
      ${priced.vat > 0 ? `<div class="totals-row"><span class="gray">VAT (12%)</span><span class="mono">${phpFmt(priced.vat)}</span></div>` : ''}
      <div class="totals-row bold"><span>Total</span><span class="mono">${phpFmt(priced.total)}</span></div>
    </div>` : '';
  const sign = (label) => `
    <div style="flex:1;text-align:center;">
      <div style="border-bottom:1px solid #111;height:38px;"></div>
      <div class="small bold" style="margin-top:3px;">${label}</div>
      <div class="small gray">Name / Signature / Date</div>
    </div>`;
  const body = `
    <div class="info-grid">
      <div class="info-box"><div class="info-lbl">DR No.</div><div class="info-val mono">${esc(dr.drNo)}</div></div>
      <div class="info-box"><div class="info-lbl">Date</div><div class="info-val">${dateFmt(dr.drDate)}</div></div>
      <div class="info-box"><div class="info-lbl">Invoice Ref.</div><div class="info-val mono">${esc(dr.invoice?.invoiceNo || '—')}</div></div>
      <div class="info-box"><div class="info-lbl">Delivered To</div><div class="info-val">${esc(dr.customer.name)}</div></div>
      <div class="info-box"><div class="info-lbl">Driver / Courier</div><div class="info-val">${esc(dr.driverName || '—')}</div></div>
      <div class="info-box"><div class="info-lbl">Vehicle / Plate No.</div><div class="info-val">${esc(dr.vehicleNo || '—')}</div></div>
    </div>
    <div class="desc-box"><strong>Delivery address:</strong> ${esc(dr.deliveryAddress || dr.customer.address || '—')}</div>
    <div class="section-title">Items Delivered</div>
    <table>
      <thead><tr><th class="center" style="width:32px;">#</th><th>Description</th><th class="right">Qty</th><th>Unit</th>${withPrices ? '<th class="right">Unit Price</th><th class="right">Amount</th>' : ''}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${totals}
    ${dr.notes ? `<div class="desc-box" style="margin-top:10px;"><strong>Remarks:</strong> ${esc(dr.notes)}</div>` : ''}
    <p class="small gray" style="margin-top:14px;">Received the above items in good order and condition.</p>
    <div style="display:flex;gap:28px;margin-top:26px;">${sign('Prepared by')}${sign('Delivered by')}${sign('Received by')}</div>`;
  await printDocument('Delivery Receipt', dr.drNo, body);
}
