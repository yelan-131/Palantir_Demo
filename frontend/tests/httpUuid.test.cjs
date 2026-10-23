const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const React=require('react');
const {renderToString}=require('react-dom/server');
const webcrypto=require('node:crypto').webcrypto;
const httpCrypto={getRandomValues:webcrypto.getRandomValues.bind(webcrypto)};
function load(relative,crypto,dependencies={}){
 const scope={exports:{},crypto,Uint8Array,require:name=>name in dependencies?dependencies[name]:require(name)};
 const source=fs.readFileSync(path.join(__dirname,'../src',relative),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,scope);
 return scope.exports;
}
test('HTTP origins generate independent RFC 4122 v4 import keys without randomUUID',()=>{
 const {createUuid}=load('utils/uuid.ts',httpCrypto);
 const ids=Array.from({length:1000},()=>createUuid());
 assert.equal(new Set(ids).size,ids.length);
 for(const id of ids)assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('secure origins preserve the native UUID implementation and receiver',()=>{
 const crypto={randomUUID(){assert.equal(this,crypto);return 'native-uuid';}};
 assert.equal(load('utils/uuid.ts',crypto).createUuid(),'native-uuid');
});
test('business form import component mounts on HTTP even with its modal closed',()=>{
 const node=({children,title})=>React.createElement('div',{title},children);
 const antd={Alert:node,Button:node,Modal:node,Select:node,Space:node,Table:node,Typography:{Text:node},message:{}};
 const uuids=load('utils/uuid.ts',httpCrypto);
 const Component=load('components/FormImport/index.tsx',httpCrypto,{'antd':antd,'@/services/api':{},'@/utils/uuid':uuids}).default;
 assert.doesNotThrow(()=>renderToString(React.createElement(Component,{formId:61,open:false,onClose(){},onImported(){}})));
});
