import { handleFoodJournal } from "./food-journal.js";
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==="/api/food-journal")return handleFoodJournal(request,env);
  if(url.pathname==="/"||url.pathname==="/food-journal"){
   return Response.redirect(url.origin+"/food-journal/",302);
  }
  return env.ASSETS.fetch(request);
 }
};
