const dates={created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z'}
const field=(id,type,title,extra={})=>({ticket_field:{id,type,title,title_in_portal:title,description:'From the previous desk',active:true,required:false,visible_in_portal:true,editable_in_portal:true,required_in_portal:true,agent_can_edit:true,...dates,...extra}})
const form=(id,name,ids,extra={})=>({ticket_form:{id,name,display_name:name,active:true,default:false,end_user_visible:true,in_all_brands:true,restricted_brand_ids:[],ticket_field_ids:ids,agent_conditions:[],end_user_conditions:[],...dates,...extra}})
export const fieldValues=[{id:301,value:'ORDER-187'},{id:302,value:2},{id:303,value:false},{id:304,value:'shipping'}]
export function configurationSource(){return [
 field(301,'text','Order number',{required:true}),field(302,'integer','Items'),field(303,'checkbox','Replacement requested'),field(304,'tagger','Reason',{custom_field_options:[{id:1,name:'Refund requested',value:'refund'},{id:2,name:'Shipment question',value:'shipping'}]}),
 form(401,'Order question',[301,302,303,304]),form(402,'Refund request',[301,304]),form(403,'Conditional request',[301],{end_user_conditions:[{parent_field_id:301,value:'urgent'}]}),
 {group:{id:71,name:'Billing',deleted:false,default:true,...dates}},{group:{id:72,name:'Technical',deleted:false,default:false,...dates}},
 {schedule:{id:73,name:'Eastern business hours',time_zone:'Eastern Time (US & Canada)',intervals:[{start_time:1980,end_time:2460}],holidays:[{id:74,name:'Winter holiday',start_date:'2024-12-25',end_date:'2024-12-26'}],...dates}},
 {view:{id:75,title:'Open work',active:true,restriction:null,conditions:{all:[{field:'status',operator:'is',value:'open'}],any:[]},execution:{sort_by:'updated_at',sort_order:'desc'},...dates}},
 {trigger:{id:76,title:'Escalate normal work',active:true,position:1,conditions:{all:[{field:'priority',operator:'is',value:'normal'}],any:[]},actions:[{field:'priority',value:'high'},{field:'current_tags',value:'reviewed-import'},{field:'group_id',value:'71'}],...dates}},
 {automation:{id:77,title:'Pending after one hour',active:true,position:2,conditions:{all:[{field:'status',operator:'is',value:'pending'},{field:'hours_since_created',operator:'greater_than',value:'1'}],any:[]},actions:[{field:'priority',value:'urgent'}],...dates}},
 {trigger:{id:78,title:'Unsupported recipient send',active:true,conditions:{all:[{field:'priority',operator:'is',value:'normal'}],any:[]},actions:[{field:'notification_user',value:['900001','Subject','Private email']}],...dates}},
]}
export function withCompany(vendor,records){
 const company={id:71,name:'Northstar Bikes',domains:['northstar.example'],...dates}
 if(vendor==='zendesk'){
  records.find(row=>row.user?.role==='end-user').user.organization_id=71
  records.push({organization:{...company,domain_names:company.domains,domains:undefined,shared_tickets:true,shared_comments:true}})
 }else if(vendor==='freshdesk'){
  records.find(row=>row.contact).contact.company_id=71;records.push({company})
 }else if(vendor==='helpscout'){
  records.find(row=>row._embedded?.customers)._embedded.customers[0].organizationId=71
  records.push({organization:{id:71,name:company.name,domains:company.domains}})
 }else{
  records.find(row=>row.type==='contact').companies={data:[{id:'company-internal',type:'company',url:'/companies/company-internal'}],total_count:1,has_more:false}
  records.push({type:'company',id:'company-internal',company_id:'external-account',name:company.name,website:'https://northstar.example',created_at:1704067200,updated_at:1704153600})
 }
 return records
}
