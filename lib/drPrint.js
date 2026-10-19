import { printDocument, dateFmt } from '@/lib/print';

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Prints a delivery receipt (A4 letterhead, items without prices, three signature lines).
export async function printDr(dr) {
  const rows = dr.lines.map((l, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${esc(l.description)}</td>
      <td class="right">${Number(l.quantity).toLocaleString('en-PH')}</td>
      <td>${esc(l.unit || '')}</td>
    </tr>`).join('');
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
      <thead><tr><th class="center" style="width:32px;">#</th><th>Description</th><th class="right">Qty</th><th>Unit</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${dr.notes ? `<div class="desc-box" style="margin-top:10px;"><strong>Remarks:</strong> ${esc(dr.notes)}</div>` : ''}
    <p class="small gray" style="margin-top:14px;">Received the above items in good order and condition.</p>
    <div style="display:flex;gap:28px;margin-top:26px;">${sign('Prepared by')}${sign('Delivered by')}${sign('Received by')}</div>`;
  await printDocument('Delivery Receipt', dr.drNo, body);
}
