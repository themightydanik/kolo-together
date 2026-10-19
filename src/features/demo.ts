export interface Task { id: string; title: string; done: boolean }
export const initialTasks: Task[] = [
  { id: 'tea', title: 'Приготовить чай друг для друга', done: false },
  { id: 'walk', title: 'Прогуляться вместе 20 минут', done: false },
  { id: 'thanks', title: 'Сказать спасибо за маленькое', done: true },
]
export async function loadDemoTasks(): Promise<Task[]> { return initialTasks.map(task => ({ ...task })) }
