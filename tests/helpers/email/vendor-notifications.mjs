import {customer,history} from '../../move-in/helpscout-fixtures.mjs'

export function vendorNotifications(){
 const scout=history(901,87),scoutEmail='scout@customer.example'
 scout.conversation.number=1901;scout.conversation.status='closed';scout.conversation.primaryCustomer.email=scoutEmail
 scout.conversation.assignee={id:77,type:'user',first:'Source',last:'Owner',email:'source-owner@example.test'}
 scout.conversation.reply_to='helpdesk+scout_901@example.test'
 for(const thread of scout.page._embedded.threads)for(const field of ['customer','createdBy'])if(thread[field]?.id===87)thread[field].email=scoutEmail
 return [
  {vendor:'zendesk',email:'zendesk@customer.example',sourceId:'921',subject:'Re: Shipment [BEEF-C0DE]',to:'helpdesk+zendesk-921@example.test',rows:[{user:{id:92,role:'end-user',name:'Zendesk Customer',email:'zendesk@customer.example',created_at:'2024-01-01T00:00:00Z'}},{ticket:{id:921,requester_id:92,subject:'Shipment [BEEF-C0DE]',status:'solved',assignee_id:77,group_id:88,via:{channel:'email'},reply_to:'helpdesk+zendesk-921@example.test',created_at:'2024-01-02T00:00:00Z',updated_at:'2024-01-02T00:00:00Z',comments:[{id:922,author_id:92,body:'Historical question',public:true,created_at:'2024-01-02T00:00:00Z'}]}}]},
  {vendor:'freshdesk',email:'fresh@customer.example',sourceId:'820',subject:'Re: Shipment [#820]',to:'helpdesk+freshdesk-820@example.test',rows:[{contact:{id:81,name:'Fresh Customer',email:'fresh@customer.example',created_at:'2024-01-01T00:00:00Z'}},{ticket:{id:820,requester_id:81,subject:'Shipment',description_text:'Historical question',reply_to:'helpdesk+freshdesk-820@example.test',status:4,responder_id:77,group_id:88,priority:1,source:1,created_at:'2024-01-02T00:00:00Z',updated_at:'2024-01-02T00:00:00Z',conversations:[]}}]},
  {vendor:'helpscout',email:scoutEmail,sourceId:'901',subject:'Re: Shipment',to:scout.conversation.reply_to,rows:[customer(87,scoutEmail),scout.conversation,scout.page]},
  {vendor:'intercom',email:'intercom@customer.example',sourceId:'v91',subject:'Re: Shipment',to:'helpdesk+intercom-v91@example.test',schema:'2.16',rows:[{type:'contact',id:'c91',name:'Intercom Customer',email:'intercom@customer.example',created_at:1704067200},{type:'conversation',id:'v91',admin_assignee_id:77,team_assignee_id:88,channel:{initial:'email'},state:'closed',created_at:1704153600,updated_at:1704153600,contacts:{type:'contact.list',contacts:[{id:'c91'}]},source:{id:'s91',body:'Historical question',reply_to:'helpdesk+intercom-v91@example.test',author:{id:'c91',type:'contact'}},conversation_parts:{type:'conversation_part.list',conversation_parts:[]}}]}
 ]
}
