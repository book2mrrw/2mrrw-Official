import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';
import {playlistTracksForPlayback} from '../../src/lib/playlists/playback.js';

const require=createRequire(import.meta.url);
let snapshot={user:{id:'listener'},ownedSlugs:['release']};
let resolved,queueCalls=0;
mock.module('@/context/AuthContext',{namedExports:{
  useAuth:()=>({user:{id:'listener'},isAdmin:false,accountState:{ownedSlugs:[]}}),
  useEntitlementAccountState:()=>snapshot,
}});
mock.module('@/context/AudioContext',{namedExports:{useAudioPlayer:()=>({playQueue:()=>queueCalls++})}});
mock.module('@/lib/playlists/playback',{namedExports:{playlistTracksForPlayback:(...args)=>{
  resolved=playlistTracksForPlayback(...args);return resolved;
}}});
const source=await readFile(new URL('../../src/components/music/PlaylistDetail.js',import.meta.url),'utf8');
const {code}=await transform(source,{loader:'jsx',format:'esm',jsxFactory:'globalThis.__playlistTestReact.createElement'});
globalThis.__playlistTestReact=React;
const moduleCode=code.replaceAll('from "react"',`from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)}`);
const {default:Detail}=await import('data:text/javascript;base64,'+Buffer.from(moduleCode).toString('base64'));

test('Playlist Detail uses hydrated entitlement snapshot and never starts playback during render',()=>{
  const props={playlist:{title:'Saved',tracks:[{slug:'song',albumSlug:'release',title:'Song'}]},catalogBySlug:new Map()};
  renderToStaticMarkup(React.createElement(Detail,props));
  assert.equal(resolved[0].metadata.access.canStream,true);
  snapshot={user:{id:'listener'},ownedSlugs:[]};
  renderToStaticMarkup(React.createElement(Detail,props));
  assert.equal(resolved[0].metadata.access.canStream,false);
  assert.equal(queueCalls,0);
});
