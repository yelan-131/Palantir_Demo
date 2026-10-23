from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from app.services.field_policies import presentation,partial_mask,design_errors
from app.services.field_uniqueness import signature

def field(name='secret',**rules):
    return SimpleNamespace(field_name=name,label=name,archived=False,ui_config={'rules':rules})

def test_short_values_are_never_revealed_and_compound_signatures_skip_empty_values():
    assert partial_mask('12',1,1)=='****'
    assert partial_mask('abcdef',0,0)=='******'
    f=field('code',unique={'enabled':True,'conditions':{'strategy':'compound','fields':['site']}})
    assert signature(f,{'code':'X','site':1})==signature(f,{'code':'X','site':1.0})
    assert signature(f,{'code':'X','site':None}) is None
    assert signature(f,{'code':'X','site':2})!=signature(f,{'code':'X','site':1})

@pytest.mark.asyncio
async def test_conditional_masks_copy_policy_and_computed_values_are_protected():
    source=field(masked={'enabled':True,'conditions':{'strategy':'partial','keepStart':1,'keepEnd':1},'conditionGroups':[[{'sourceField':'status','operator':'equals','value':'private'}]]},copyable={'enabled':True,'conditions':{'strategy':'maskedCopy'}})
    calculated=field('derived');calculated.ui_config['computed']={'expression':"secret + '-suffix'"}
    safe,states=await presentation(None,{},[source,calculated],{'secret':'abcdef','derived':'abcdef-suffix','status':'private'})
    assert safe['secret']=='a****f' and safe['derived']=='••••••'
    assert states['secret']['copyMode']=='maskedCopy' and 'abcdef' not in str(states)
    safe,states=await presentation(None,{},[source],{'secret':'abcdef','status':'public'})
    assert safe['secret']=='abcdef' and not states['secret']['masked']

def test_invalid_compound_and_mask_settings_block_publication():
    assert design_errors([{'field_name':'a','label':'A','field_type':'string','ui_config':{'rules':{'unique':{'enabled':True,'conditions':{'strategy':'compound','fields':['missing']}}}}}])
    assert design_errors([{'field_name':'a','label':'A','field_type':'string','ui_config':{'rules':{'masked':{'enabled':True,'conditions':{'keepStart':-1}}}}}])
