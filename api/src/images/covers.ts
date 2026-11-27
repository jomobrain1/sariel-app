import { randomInt, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { createHttpError, defineRoutes, rateLimit } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { individual } from '../individual/account.js';
import { aiImage } from '../ai/service.js';
import { fromDataUrl, imageBody, normalize } from './codec.js';

// Cover photos: ordinary pictures a person can later turn into a report photo.
// The image provider only ever receives one of these fixed prompts, never anything the person types,
// so no safety information can reach it.
export const themes = {
  mountains:{label:'Mountains', prompt:'A calm landscape photograph of green mountains above a still lake'},
  beach:{label:'Beach', prompt:'A photograph of a quiet sandy beach with gentle waves and palm trees'},
  flowers:{label:'Flowers', prompt:'A close-up photograph of a bunch of colourful garden flowers in a vase'},
  food:{label:'Food', prompt:'A top-down photograph of a plate of fresh fruit on a wooden table'},
  coffee:{label:'Coffee', prompt:'A photograph of a cup of coffee and a small pastry on a cafe table'},
  city:{label:'City', prompt:'A photograph of a city skyline with soft lights'},
  forest:{label:'Forest', prompt:'A photograph of a sunlit path through a green forest'},
  sunset:{label:'Sunset', prompt:'A photograph of an orange sunset over open fields'},
} as const;
type Theme = keyof typeof themes;
const moods = ['in soft morning light', 'at golden hour', 'on a bright clear day', 'on a calm overcast day', 'at dusk'];
export const COVER_DAYS = 7;

export interface Cover {
  _id:string; owner:string; kind:'generated'|'upload'|'library'; theme?:string; png:mongoose.mongo.Binary;
  width:number; height:number; bytes:number; createdAt:Date; expiresAt:Date;
}
export const covers = () => mongoose.connection.collection<Cover>('sariel_cover_images');
let indexed: Promise<unknown> | undefined;
const ensureIndexes = () => indexed ??= Promise.all([
  covers().createIndex({owner:1, createdAt:-1}),
  covers().createIndex({expiresAt:1}, {expireAfterSeconds:0}),
]).catch(error => { indexed = undefined; throw error; });

const MAX_COVERS = 30;
const view = (c:Omit<Cover, 'png'>) => ({id:c._id, kind:c.kind, theme:c.theme ?? null, width:c.width, height:c.height, bytes:c.bytes, createdAt:c.createdAt, expiresAt:c.expiresAt});

async function store(owner:string, kind:Cover['kind'], raw:Buffer, theme?:string) {
  await ensureIndexes();
  if (await covers().countDocuments({owner}) >= MAX_COVERS)
    throw createHttpError(422, 'TOO_MANY_IMAGES', `You can keep up to ${MAX_COVERS} photos. Delete some first.`);
  const {png, width, height} = normalize(raw);
  const now = new Date();
  const cover:Cover = {_id:randomUUID(), owner, kind, ...(theme ? {theme} : {}), png:new mongoose.mongo.Binary(png), width, height,
    bytes:png.length, createdAt:now, expiresAt:new Date(now.getTime() + COVER_DAYS * 24 * 60 * 60 * 1000)};
  await covers().insertOne(cover);
  return cover;
}

/** Loads a person's own cover photo as PNG bytes. */
export async function coverPng(owner:string, id:string) {
  const cover = await covers().findOne({_id:id, owner});
  if (!cover) throw createHttpError(404, 'NOT_FOUND', 'Photo unavailable. It may have expired.');
  return Buffer.from(cover.png.buffer);
}

export default defineRoutes(router => {
  router.group({prefix:'/api/individual/images', middleware:individual}, () => {
    router.get('/themes', ctx => ctx.response.success(Object.entries(themes).map(([id, t]) => ({id, label:t.label}))));

    router.get('/', async ctx => {
      await ensureIndexes();
      const rows = await covers().find({owner:auth.user(ctx).id}, {projection:{png:0}}).sort({createdAt:-1}).toArray();
      return ctx.response.success(rows.map(view));
    });

    router.get('/:id', async ctx => {
      const png = await coverPng(auth.user(ctx).id, String(ctx.params.id));
      return ctx.response.success({dataUrl:'data:image/png;base64,' + png.toString('base64')});
    }, {validate:{params:z.object({id:z.uuid()})}});

    router.post('/generate', async ctx => {
      const user = auth.user(ctx);
      const theme = (ctx.body as {theme:Theme}).theme;
      const prompt = `${themes[theme].prompt} ${moods[randomInt(moods.length)]}. Realistic photo, natural colours, no people, no text, no logos.`;
      const result = await aiImage('cover-image', user.id, prompt);
      const cover = await store(user.id, 'generated', result.data, theme);
      return ctx.response.created(view(cover));
    }, {middleware:[rateLimit({windowMs:60_000, max:6})], validate:{body:z.strictObject({theme:z.enum(Object.keys(themes) as [Theme, ...Theme[]])})}});

    router.post('/upload', async ctx => {
      const body = ctx.body as {image:string; kind:'upload'|'library'};
      const cover = await store(auth.user(ctx).id, body.kind, fromDataUrl(body.image));
      return ctx.response.created(view(cover));
    }, {middleware:[imageBody, rateLimit({windowMs:60_000, max:20})],
      validate:{body:z.strictObject({image:z.string().min(32), kind:z.enum(['upload', 'library']).default('upload')})}});

    router.delete('/:id', async ctx => {
      const result = await covers().deleteOne({_id:String(ctx.params.id), owner:auth.user(ctx).id});
      if (!result.deletedCount) throw createHttpError(404, 'NOT_FOUND', 'Photo unavailable.');
      return ctx.response.noContent();
    }, {validate:{params:z.object({id:z.uuid()})}});
  });
});
