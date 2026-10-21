import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCredits, creditRows, publicCredits, percentageHundredths, allocationResult, editableCreditGroups, validateCreditGroups, mergeCreditProjection, optionalIdentifier } from '../contract.js';
import { publicationCredits, metadataPatch } from '../publication.js';
import { getReleaseEditorial, getCreditsDisplayRows } from '../../../components/preview/releaseMetadata.js';
import { mapProductRow } from '../../media/catalog-db.js';
import { mapControlSystemRelease } from '../../control-system/releases.js';

const person = (name, percentage = '') => ({ name, percentage });
const group = (entries, state = 'complete') => ({ entries, state });
const uuidA = '11111111-1111-4111-8111-111111111111';
const uuidB = '22222222-2222-4222-8222-222222222222';

for (const [label, source] of [
  ['publisher object', { credits: { written_by: ['Writer'], produced_by: ['Producer'], featured_artists: ['Guest'] } }],
  ['role arrays', { credits: [{ name: 'Writer', role: 'writer' }, { name: 'Producer', role: 'produced by' }, { name: 'Guest', role: 'featured artist' }] }],
  ['top-level fields', { writtenBy: ['Writer'], producedBy: ['Producer'], featuredArtists: ['Guest'] }],
  ['nested metadata object', { metadata: { credits: { written_by: ['Writer'], produced_by: ['Producer'], featured_artists: ['Guest'] } } }],
  ['nested metadata array', { metadata: { credits: [{ name: 'Writer', role: 'songwriter' }, { name: 'Producer', role: 'producer' }, { name: 'Guest', role: 'featured' }] } }],
]) test(`reads ${label}`, () => assert.deepEqual(normalizeCredits(source).map(c => [c.role, c.name]), [['songwriter','Writer'], ['producer','Producer'], ['featured_artist','Guest']]));

test('release and recording attribution remain separate', () => {
  const release = { written_by: ['Release Writer'], tracks: [{ written_by: ['Track Writer'] }] };
  assert.equal(getReleaseEditorial(release).writtenBy, 'Release Writer');
  assert.equal(getReleaseEditorial(release.tracks[0]).writtenBy, 'Track Writer');
});
test('empty credits never invent attribution', () => assert.deepEqual(getCreditsDisplayRows(getReleaseEditorial({ slug: 'unknown' })), []));
test('an explicit scoped clear suppresses stale nested values', () => assert.deepEqual(normalizeCredits({ credits: { written_by: [] }, metadata: { written_by: ['Stale'] } }), []));
test('all rows and extended roles survive normalization', () => {
  const source = { credits: [{ name: 'W',role:'writer' },{ name:'P',role:'producer' },{ name:'F',role:'featured' },{ name:'M',role:'mixing engineer' },{ name:'X',role:'Art Direction' }] };
  assert.equal(creditRows(source).length, 5);
  assert.equal(creditRows(source)[4].label, 'Art Direction');
});
test('contributor order and separate same-name identities survive', () => {
  const entries = normalizeCredits({ credits: { produced_by: [{ name:'Same',contributor_id:uuidB }, { name:'Same',contributor_id:uuidA }] } });
  assert.deepEqual(entries.map(e => e.contributor_id), [uuidB,uuidA]);
});
test('public projection strips allocations, emails and linked users', () => {
  const source = { credits: { groups: { producer: group([{ name:'P',percentage:'100',email:'private',user_id:'private',contributor_id:uuidA }]) } } };
  assert.deepEqual(publicCredits(source), [{ name:'P',role:'producer',contributor_id:uuidA }]);
});
test('catalog mapper preserves publisher credits', () => {
  const output = mapProductRow({ id:uuidA,slug:'release',product_type:'single',active:true,credits:{ written_by:['Writer'] },metadata:{} });
  assert.equal(output.credits[0].name, 'Writer');
});
test('control-system mapper preserves recording credits and scope', () => {
  const output = mapControlSystemRelease({ id:uuidA,slug:'release',title:'Release',credits:{written_by:['Release Writer']},tracks:[{id:uuidB,slug:'song',title:'Song',credits:{produced_by:['Track Producer']}}]}, {}, 0, 'https://example.invalid');
  assert.equal(output.credits[0].name, 'Release Writer'); assert.equal(output.tracks[0].credits[0].name, 'Track Producer');
});
for (const values of [['70.00','30.00'],['33.33','33.33','33.34'],['100']]) test(`exact complete total ${values.join('+')}`, () => {
  const output = allocationResult(group(values.map((v,i) => person(`Person ${i}`, v))), 'songwriter');
  assert.equal(output.total, 10000); assert.equal(output.valid, true);
});
for (const value of ['99.99','100.01']) test(`reject completed total ${value}`, () => assert.equal(allocationResult(group([person('Writer',value)]),'songwriter').valid, false));
for (const value of ['-1','NaN','Infinity','1.001','1e2','100.01','',null,NaN,Infinity,' 10','0x10']) test(`reject percentage ${String(value)}`, () => assert.throws(() => percentageHundredths(value)));
test('incomplete drafts and legacy names are valid without fabricated percentages', () => {
  for (const state of ['draft','legacy']) assert.equal(allocationResult(group([person('Writer')],state),'songwriter').valid,true);
});
test('a completed percentage without a contributor fails', () => assert.equal(allocationResult(group([person('', '100')]),'songwriter').valid,false));
test('malformed category and entry structures return errors rather than throw', () => {
  for (const value of [null, [], {state:'draft',entries:'bad'}, {state:'not_applicable',entries:[null]}]) assert.equal(allocationResult(value,'producer').valid,false);
});
test('producer category is optional and independent', () => {
  assert.equal(validateCreditGroups({ songwriter:group([person('Writer','100')]), producer:group([],'not_applicable') }).length,0);
  assert.match(validateCreditGroups({ songwriter:group([person('Writer','100')]), producer:group([person('Producer','90')]) }).join(' '), /Produced By/);
});
test('selected UUID is preserved while the historical display name changes', () => {
  const source = { credit_groups: { producer:group([{name:'Original',contributor_id:uuidA,percentage:''}],'legacy') } };
  const editable = editableCreditGroups(source); editable.producer.entries[0] = { ...editable.producer.entries[0],name:'Corrected' };
  assert.equal(editable.producer.entries[0].contributor_id,uuidA);
});
test('same-name contributors may have separate UUIDs; duplicate UUID allocation is rejected', () => {
  assert.equal(allocationResult(group([{...person('Same','70'),contributor_id:uuidA},{...person('Same','30'),contributor_id:uuidB}]),'producer').valid,true);
  assert.equal(allocationResult(group([{...person('Same','70'),contributor_id:uuidA},{...person('Same','30'),contributor_id:uuidA}]),'producer').valid,false);
});
for (const existing of [{written_by:['Old'],mixing_engineer:'Engineer',custom:{untouched:true}},[{name:'Old',role:'writer'},{name:'Engineer',role:'mixing engineer',custom:'retained'}]]) test(`editing preserves extended ${Array.isArray(existing)?'array':'object'} credits`, () => {
  const original=structuredClone(existing); const next=mergeCreditProjection(existing,{songwriter:group([person('New')],'legacy')});
  assert.equal(normalizeCredits({credits:next}).find(e=>e.role==='mixing_engineer').name,'Engineer');
  assert.deepEqual(existing,original);
});
test('partial publication preserves attribution and unrelated metadata', () => {
  const old={written_by:['Writer'],produced_by:['Producer'],mixing_engineer:'Engineer',isrc:'Legacy-ID'};
  assert.deepEqual(publicationCredits(old,{title:'Changed'}),old);
  assert.deepEqual(metadataPatch({custom:42,genre:'Old'},{genre:'New'},['genre']),{custom:42,genre:'New'});
});
test('empty defaults from older publisher clients cannot erase credits', () => {
  const old={written_by:['Writer'],executive_producer:'Executive'};
  assert.deepEqual(publicationCredits(old,{written_by:[],produced_by:[],executive_producer:''}),old);
});
test('versioned explicit clear removes only the selected category', () => {
  const old={written_by:['Writer'],produced_by:['Producer'],mastering_engineer:'Engineer'};
  const next=publicationCredits(old,{credit_patch_version:1,credit_groups:{songwriter:group([],'legacy')}});
  assert.deepEqual(next,{written_by:[],produced_by:['Producer'],mastering_engineer:'Engineer'});
});
test('unversioned structured publication is rejected', () => assert.throws(()=>publicationCredits({}, {credit_groups:{songwriter:group([],'legacy')}})));
test('identifiers preserve leading zeros and historical text with explicit clearing', () => {
  assert.equal(optionalIdentifier('001234567890','UPC'),'001234567890');
  assert.equal(optionalIdentifier('Legacy-ID','ISRC'),'Legacy-ID');
  assert.equal(optionalIdentifier('','ISRC'),null);assert.equal(optionalIdentifier(null,'ISRC'),null);
  assert.throws(()=>optionalIdentifier(123,'UPC')); assert.throws(()=>optionalIdentifier('bad\nvalue','UPC'));
  assert.equal(publicationCredits({isrc:'Saved'},{title:'Changed'}).isrc,'Saved');
  assert.equal(publicationCredits({isrc:'Saved'},{isrc:''}).isrc,null);
});
