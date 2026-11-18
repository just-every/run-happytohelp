export const statusNames = {new:'New',open:'Open',pending:'Pending',on_hold:'On hold',solved:'Solved',closed:'Closed'};
export const statusMeanings = {
 new:'Nobody has answered yet. Customer request: Open.',
 open:'Being worked on. Customer request: Open.',
 pending:'Waiting for the customer. Customer request: Open.',
 on_hold:'Waiting for someone else. Customer request: Open.',
 solved:'Answered; a customer reply reopens it. Customer request: Solved.',
 closed:'Finished; customer replies start a new conversation. Customer request: Solved.',
};
export function statusName(status) {
 const name = status.name?.replace(/^On-hold$/i,'On hold');
 return name || statusNames[status.category] || 'Status';
}
