import { expect,type Locator } from '@playwright/test'

/** Native author controls with controlled engineering pixels only. */
export async function confirmEngineeringVisualReview(card:Locator,name:string){
  const review=card.getByRole('region',{name:`视觉评审：${name}`,exact:true})
  await expect(review).toBeVisible()
  await expect(review.getByRole('img').first()).toBeVisible()
  for(const label of ['身份与造型','参考连续性','构图与完整性','可辨认性','透明边缘']){
    const control=review.getByRole('combobox',{name:`观察结果：${label}`,exact:true})
    if(await control.inputValue()!=='not-applicable')await control.selectOption('pass')
  }
  await review.getByRole('textbox',{name:'本次评审依据与修订说明',exact:true}).fill('重新对照准确工程图与全部参考，原先控制问题已重新核对；本次只验证工程流程，不认定艺术质量。')
  await review.getByRole('button',{name:`保存视觉评审候选：${name}`,exact:true}).click()
  await review.getByRole('checkbox',{name:'我已核对这份准确评审及未观察项',exact:true}).check()
  await review.getByRole('button',{name:`确认评审记录：${name}`,exact:true}).click()
  await expect(card.getByRole('button',{name:`保存选图候选：${name}`,exact:true})).toBeEnabled()
}
