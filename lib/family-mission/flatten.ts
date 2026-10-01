import 'server-only';
import {assertPlannerRecord} from './record-namespaces';
export class FlattenInputError extends Error {}
export class FlattenConflict extends Error {}
export async function flattenRecord(raw:any):Promise<never>{assertPlannerRecord(raw);throw new FlattenInputError('La migración de tareas D1 está desactivada: las tareas viven en Google Tasks.');}
