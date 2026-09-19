import {it,expect} from 'vitest';
import {changedChat} from '../../components/mission/dashboard-refresh';
it('refreshes when a pending action completes',()=>{expect(changedChat([{id:'a',status:'pending'}],[{id:'a',status:'completed'}])).toBe(true);});
it('refreshes partial changes after failed or cancelled runs',()=>{for(const status of ['failed','cancelled'])expect(changedChat([{id:'a',status:'pending'}],[{id:'a',status}])).toBe(true);});
it('does not refresh repeatedly from old history or another message',()=>{expect(changedChat([],[{id:'a',status:'completed'}])).toBe(false);expect(changedChat([{id:'a',status:'completed'}],[{id:'a',status:'completed'}])).toBe(false);expect(changedChat([{id:'a',status:'pending'}],[{id:'b',status:'completed'}])).toBe(false);});
