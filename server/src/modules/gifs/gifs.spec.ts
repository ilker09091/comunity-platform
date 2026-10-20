import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GifsService } from './gifs.js';

describe('GIF provider failure and validation paths',()=>{
  let service:GifsService;
  const gif=(id='safe123',extra={})=>({id,title:'Safe GIF',rating:'pg',images:{fixed_width:{webp:`https://media0.giphy.com/media/${id}/200.webp`,width:'200',height:'150'}},...extra});
  beforeEach(()=>{vi.stubEnv('GIPHY_API_KEY','local-test-key');vi.stubEnv('GIPHY_RATING','pg-13');service=new GifsService();});
  afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
  const respond=(value:unknown)=>vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify(value)))));
  it('filters malformed, unsafe-host and over-rating results',async()=>{
    respond({data:[null,gif(),gif('adult123',{rating:'r'}),gif('bad123',{images:{fixed_width:{url:'https://media0.giphy.com.evil.test/a.gif'}}})]});
    expect((await service.list(undefined)).items.map(item=>item.id)).toEqual(['safe123']);
  });
  it('never resolves an individual GIF above the configured rating',async()=>{
    respond({data:gif('adult123',{rating:'r'})});
    await expect(service.resolve('adult123')).rejects.toMatchObject({status:404});
  });
  it('paginates provider results and caches identical search queries',async()=>{
    respond({data:Array.from({length:24},(_,i)=>gif(`gif${1000+i}`)),pagination:{total_count:48}});
    expect((await service.list('cats')).nextOffset).toBe(24);
    await service.list('cats');expect(fetch).toHaveBeenCalledTimes(1);
    expect((await service.list('cats',24)).nextOffset).toBeNull();expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('returns a recoverable error for bad JSON or a malformed list',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('not-json')));
    await expect(service.list('broken')).rejects.toMatchObject({status:422});
    respond({data:{unexpected:true}});
    await expect(service.list('invalid')).rejects.toMatchObject({status:422});
  });
  it('turns provider outages and authentication failures into a recoverable error',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('Offline')));
    await expect(service.list('offline')).rejects.toMatchObject({status:422});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:403})));
    await expect(service.list('forbidden')).rejects.toMatchObject({status:422});
  });
});
