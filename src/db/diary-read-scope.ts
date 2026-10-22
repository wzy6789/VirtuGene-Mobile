import {isVisibleToCharacter,type VisibilitySubject} from '../lib/world/visibility';

/** Derived lookup keys from the current declaration, never an authorization
 * cache. Callers still check the actual row, deletion and source revocations. */
export function diaryReadScopeKeys(row:VisibilitySubject&{userId?:string;deletedAt?:number}):Array<[string,string]>{
  if(!row.userId||row.deletedAt)return [];
  const candidates=row.visibility==='world'
    ?typeof row.characterId==='string'&&row.characterId?[row.characterId]:[]
    :row.visibility==='selected'&&Array.isArray(row.visibleTo)?row.visibleTo.filter(id=>typeof id==='string'&&!!id):[];
  return [...new Set(candidates)].filter(id=>isVisibleToCharacter(row,id)).map(id=>[row.userId!,id]);
}
