export const dispatchDoor='https://conversation.internal/dispatch'
export const dispatchedUrl='X-H2H-Dispatched-Url'

export function originalRequest(forwarded:Request){
 const request=new Request(forwarded.headers.get(dispatchedUrl)!,forwarded)
 request.headers.delete(dispatchedUrl)
 return request
}
