import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommunityUI, withdrawPublicationCache} from '../web/community-ui.js';
test('withdrawal clears only the removed publication and invalidates pending reads',()=>{
 const ui=createCommunityUI();
 ui.real.rows=[{id:'gone'},{id:'kept'}];ui.real.myLikes=['gone','kept'];ui.real.loading=true;
 ui.openRealCard={publishedId:'gone'};ui.cloudQuotes={rows:[{publishedId:'gone'},{publishedId:'kept'}],epoch:4,loadedFor:'u',loading:true};
 const before=ui.real.epoch;withdrawPublicationCache(ui,'gone');
 assert.deepEqual(ui.real.rows,[{id:'kept'}]);assert.deepEqual(ui.real.myLikes,['kept']);
 assert.equal(ui.real.epoch,before+1);assert.equal(ui.openRealCard,null);
 assert.deepEqual(ui.cloudQuotes.rows,[{publishedId:'kept'}]);assert.equal(ui.cloudQuotes.epoch,5);
 assert.equal(ui.cloudQuotes.loadedFor,null);assert.equal(ui.cloudQuotes.loading,false);
});
