import mongoose from 'mongoose';
import { createHttpError, currentTenantScope, type Middleware } from '@tilcayo/core';
import { Tenant } from '@tilcayo/auth';
import { z } from 'zod';
import { auth } from '../auth.js';

export const platformOnly: Middleware = (ctx, next) => {
  if (currentTenantScope()?.tenantId || auth.user(ctx).platformRole !== 'superadmin')
    throw createHttpError(403, 'FORBIDDEN', 'Platform administrator required');
  return next();
};
export const id = z.string().regex(/^[a-f0-9]{24}$/i);
export const label = z.string().trim().min(1).max(120);
export const country = z.string().regex(/^[A-Z]{2}$/, 'Use a two-letter uppercase country code');
export const labels = z.array(label).max(60);
export const platform = z.strictObject({ platformName: label, supportEmail: z.email(), defaultLanguage: label });
export const profile = z.strictObject({
  category: z.enum(['Government','Diplomatic mission','Law enforcement','Labour regulator','Humanitarian','GBV support','Legal aid']),
  verification: z.enum(['pending','verified','rejected']), countries: z.array(country).min(1).max(100),
  jurisdictions: labels.min(1), incidentCategories: labels.min(1), capabilities: labels.min(1),
  officialEmail: z.email(), officialPhone: label, operatingHours: label, timeZone: label.refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }), available: z.boolean(), preferredLanguage: label,
});
export async function requireTenant(tenantId: string) {
  return Tenant.firstOrFail({ _id: tenantId, deletedAt: null });
}
export const Config = mongoose.model('SarielConfiguration', new mongoose.Schema({
  _id: {type: String, required: true}, revision: {type: Number, required: true},
  value: mongoose.Schema.Types.Mixed, history: [{actor: String, at: Date, revision: Number}],
}));
export async function save(key: string, revision: number, value: unknown, actor: string) {
  const record = await Config.findOneAndUpdate({_id:key, revision}, {
    $set:{value}, $inc:{revision:1}, $push:{history:{actor, at:new Date(), revision:revision+1}},
  }, {upsert:revision === 0, returnDocument:'after'}).catch(error => {
    if (error.code === 11000) return null;
    throw error;
  });
  if (!record) throw createHttpError(409,'CONFLICT','Configuration changed. Reload and try again.');
  return record;
}
