import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTorBootstrap, boundedBytes, torStartupStage } from '../src/tor-bootstrap';
import { publishTorBootstrap } from '../scripts/update-tor-bootstrap';
const archive=new Uint8Array([0x28,0xb5,0x2f,0xfd,1,2,3]);
const manifest=()=>({version:1,updatedAt:Date.now(),archive:'tor-bootstrap-test.zip.zst',sha256:createHash('sha256').update(archive).digest('hex')});
const base='https://portfolio.example/ipfs/CID/';

test('fresh bootstrap mirror checks bounded bytes, same-origin archive and digest before passing to Tor', async()=>{
  const calls: {url:string;init:RequestInit}[]=[], messages:string[]=[];
  const bytes=await loadTorBootstrap('./tor-bootstrap.json',new AbortController().signal,message=>messages.push(message),async(url,init)=>{
    calls.push({url:String(url),init:init!});
    return String(url).endsWith('.json')?Response.json(manifest()):new Response(archive);
  },base);
  expect(bytes).toEqual(archive);
  expect(calls.map(call=>call.url)).toEqual([base+'tor-bootstrap.json',base+'tor-bootstrap-test.zip.zst']);
  expect(calls.every(call=>call.init.credentials==='omit'&&call.init.redirect==='error'&&call.init.cache==='no-store')).toBe(true);
  expect(messages.at(-1)).toContain('verify directory signatures');
});
test('missing, stale, oversized, cross-origin and tampered mirrors fall back without accepting bytes',async()=>{
  for(const change of [{updatedAt:Date.now()-7*3600_000},{updatedAt:Date.now()+120_000},{archive:'https://evil.example/snapshot'},{sha256:'0'.repeat(64)},{version:2}]){
    const messages:string[]=[];
    const bytes=await loadTorBootstrap('./tor-bootstrap.json',new AbortController().signal,message=>messages.push(message),async(url)=>String(url).endsWith('.json')?Response.json({...manifest(),...change}):new Response(archive),base);
    expect(bytes).toBeUndefined();expect(messages.at(-1)).toContain('using the saved directory');
  }
  await expect(loadTorBootstrap('./tor-bootstrap.json',new AbortController().signal,()=>{},async()=>new Response('missing',{status:404}),base)).resolves.toBeUndefined();
  await expect(boundedBytes(new Response(new Uint8Array(100)),50)).rejects.toThrow('size limit');
  await expect(boundedBytes(new Response('x',{headers:{'content-length':'100'}}),50)).rejects.toThrow('size limit');
  const controller=new AbortController();controller.abort(new Error('cancelled'));
  await expect(loadTorBootstrap('./tor-bootstrap.json',controller.signal,()=>{},async()=>Response.json(manifest()),base)).rejects.toThrow('cancelled');
});
test('gateway, directory, guard and circuit stages are inferred only from corresponding diagnostics',()=>{
  expect(torStartupStage('Could not connect to guard [scrubbed].')).toBe('Connecting to a Tor guard…');
  expect(torStartupStage('Fetching bootstrap.zip.zst')).toBe('Loading Tor directory…');
  expect(torStartupStage('Dialing gateway')).toBe('Connecting to Tor gateways…');
  expect(torStartupStage('Building circuit')).toBeUndefined(); // Unrecognized wording does not invent progress.
  expect(torStartupStage('circuit: building')).toBe('Building a Tor circuit…');
  expect(torStartupStage('Unable to get total available memory')).toBeUndefined();
});
test('mirror publisher writes immutable bytes before an atomic manifest and rejects old archives',async()=>{
  const root=await mkdtemp(join(tmpdir(),'anonfolio-bootstrap-'));
  try {
    const source=join(root,'bootstrap.zip.zst'),destination=join(root,'public');
    await Bun.write(source,archive);
    const result=await publishTorBootstrap(source,destination);
    expect(await Bun.file(join(destination,'tor-bootstrap.json')).json()).toEqual(result);
    expect(new Uint8Array(await Bun.file(join(destination,result.archive)).arrayBuffer())).toEqual(archive);
    await utimes(source,new Date(0),new Date(0));
    await expect(publishTorBootstrap(source,destination)).rejects.toThrow('six hours');
    expect(await Bun.file(join(destination,'tor-bootstrap.json')).json()).toEqual(result);
  }finally{await rm(root,{recursive:true,force:true});}
});
