/** Measurements accompany the public browser journey's screenshots. */
export const referenceLayout = page => page.evaluate(() => {
 const box = element => {
  const {x,y,width,height,right,bottom} = element.getBoundingClientRect();
  return {x,y,width,height,right,bottom};
 };
 return {
  viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth-innerWidth,
  textareas:[...document.querySelectorAll('.knowledge-reference-editor textarea')].map(element=>({box:box(element),clientHeight:element.clientHeight,scrollHeight:element.scrollHeight,scrollTop:element.scrollTop})),
  editors:[...document.querySelectorAll('.knowledge-reference-editor')].map(element=>({box:box(element),clientHeight:element.clientHeight,scrollHeight:element.scrollHeight,scrollTop:element.scrollTop})),
  controls:[...document.querySelectorAll('.knowledge-reference-card button,.article-picker button,.article-picker summary,.knowledge-article-insert select,.knowledge-article-insert button,.bulk-macros summary,.knowledge-upgrade-report a')].map(element=>({tag:element.tagName,label:element.getAttribute('aria-label')||element.textContent.trim().slice(0,80),box:box(element)})),
  definition:[...document.querySelectorAll('.macro-history td[data-label="Definition"]')].map(box),
  badges:[...document.querySelectorAll('.knowledge-reference-card__recipients li')].map(element=>({listStyle:getComputedStyle(element).listStyleType,marginLeft:getComputedStyle(element).marginLeft})),
 };
});
