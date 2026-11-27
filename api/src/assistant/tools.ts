import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { currentStatus, levels, recordStatus } from '../individual/status.js';
import { members, names } from '../circle/members.js';
import { postUpdate, updates } from '../circle/updates.js';
import { lastKnownLocation, settings as locationSettings } from '../circle/location.js';
import { overview as welfareOverview, recordCheckIn } from '../welfare/welfare.js';
import type { ToolSpec } from '../ai/types.js';

// Every tool acts only for the signed-in person. The model never supplies a user ID, and
// schemas are strict so extra arguments (such as someone else's ID) are rejected.
export interface ToolContext { userId:string; userName:string }
interface Tool<S extends z.ZodType> {
  kind:'read'|'action';
  description:string;
  schema:S;
  /** A plain-language line shown on the confirmation card (actions only). */
  summary?:(args:z.output<S>) => string;
  run:(ctx:ToolContext, args:z.output<S>) => Promise<unknown>;
}
const tool = <S extends z.ZodType>(t:Tool<S>) => t;
const none = z.strictObject({});
const levelLabels = ['Unknown', 'Confirmed safe', 'Assistance needed', 'Safety concern', 'Serious danger', 'Critical danger'];

export const tools = {
  get_my_safety_status:tool({kind:'read', schema:none,
    description:'Get the person’s current safety status and when it was last reported.',
    run:async ctx => {
      const status = await currentStatus(ctx.userId);
      return {level:status.level, status:levelLabels[status.level], reportedAt:status.reportedAt};
    }}),

  get_my_circle:tool({kind:'read', schema:none,
    description:'List the people in the person’s safety circle (what each can see) and the circles they belong to.',
    run:async ctx => {
      const [mine, joined] = await Promise.all([
        members().find({owner:ctx.userId}).toArray(),
        members().find({member:ctx.userId, state:'active'}).toArray(),
      ]);
      const owners = await names(joined.map(m => m.owner));
      return {
        peopleInMyCircle:mine.map(m => ({name:m.state === 'active' ? m.name : null, invitePending:m.state === 'pending',
          relationship:m.relationship, canSee:Object.entries(m.permissions).filter(([, v]) => v).map(([k]) => k)})),
        circlesIAmIn:joined.map(m => ({name:owners.get(m.owner) ?? 'Sariel user', relationship:m.relationship})),
      };
    }}),

  get_check_in_schedule:tool({kind:'read', schema:none,
    description:'Get the person’s scheduled welfare check-in settings, next due time and state.',
    run:async ctx => {
      const w = await welfareOverview(ctx.userId);
      return {enabled:w.enabled, everyHours:w.intervalHours, state:w.state, nextDue:w.dueAt, lastCheckIn:w.lastCheckInAt};
    }}),

  get_location_sharing:tool({kind:'read', schema:none,
    description:'Check whether location sharing is on and when a location was last sent. Never returns coordinates.',
    run:async ctx => {
      const [row, latest] = await Promise.all([locationSettings().findOne({_id:ctx.userId}), lastKnownLocation(ctx.userId)]);
      return {sharing:row?.locationSharing ?? false, lastSentAt:latest?.recordedAt ?? null};
    }}),

  get_circle_updates:tool({kind:'read', schema:none,
    description:'Get recent updates posted by people who share updates with this person.',
    run:async ctx => {
      const sharing = await members().find({member:ctx.userId, state:'active', 'permissions.updates':true}).toArray();
      const owners = sharing.map(m => m.owner);
      const rows = owners.length ? await updates().find({owner:{$in:owners}}).sort({createdAt:-1}).limit(10).toArray() : [];
      const people = await names(owners);
      return rows.map(u => ({from:people.get(u.owner) ?? 'Sariel user', text:u.text, at:u.createdAt}));
    }}),

  report_incident:tool({kind:'action',
    schema:z.strictObject({
      level:z.number().int().min(2).max(5).describe('2 Assistance needed, 3 Safety concern, 4 Serious danger, 5 Critical danger'),
      category:z.string().trim().min(1).max(60).describe('Short category such as welfare, medical, harassment, labour exploitation'),
      country:z.string().regex(/^[A-Z]{2}$/).optional().describe('Two-letter country code if known'),
      description:z.string().trim().max(500).optional().describe('Short description of what is happening, in the person’s words'),
    }),
    description:'Report a safety incident for the person. The app asks the person to confirm before anything is sent.',
    summary:args => `Report “${levelLabels[args.level]}” (${args.category}${args.country ? ', ' + args.country : ''}) to responders${args.description ? `: “${args.description}”` : ''}`,
    run:async (ctx, args) => {
      const result = await recordStatus(ctx.userId, {level:args.level, category:args.category, country:args.country, note:args.description, requestId:randomUUID()}, 'account');
      return {reported:true, status:levelLabels[result.level], reference:result.reference.slice(0, 12)};
    }}),

  check_in_safe:tool({kind:'action', schema:none,
    description:'Record that the person is safe: resets their check-in schedule and tells their circle they are OK.',
    summary:() => 'Check in and tell your circle you’re OK',
    run:async ctx => {
      await recordCheckIn(ctx.userId, new Date(), {recordSafe:true});
      return {checkedIn:true, status:levels[1]};
    }}),

  post_circle_update:tool({kind:'action',
    schema:z.strictObject({text:z.string().trim().min(1).max(280).describe('The update to share, written in the first person')}),
    description:'Post a short update to the person’s circle, e.g. travel plans. The app asks the person to confirm the exact text.',
    summary:args => `Post to your circle: “${args.text}”`,
    run:async (ctx, args) => {
      const update = await postUpdate(ctx.userId, ctx.userName, args.text);
      return {posted:true, text:update.text};
    }}),
};
export type ToolName = keyof typeof tools;

export const toolSpecs: ToolSpec[] = Object.entries(tools).map(([name, t]) => ({
  name, description:t.description,
  parameters:z.toJSONSchema(t.schema, {target:'draft-7'}) as Record<string, unknown>,
}));
