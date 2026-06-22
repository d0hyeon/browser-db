import { useState } from 'react'
import { useQuery, useMutation, useQueryClient, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { openDB, defineStore, field } from 'schema-idb'
import type { InferStore } from 'schema-idb'
import './App.css'

// =============================================================================
// Schema Definition
// =============================================================================
const Status = ['A', 'B'] as const;
const todosStore = defineStore('todos', {
  id: field.string().primaryKey(),
  title: field.string(),
  completed: field.boolean().index().default(false),
  createdAt: field.number().default(Date.now()),
  data: field.object({
    name: field.string().array(),
  }).optional()
})

type Todo = InferStore<typeof todosStore>

const stores = [todosStore] as const

// =============================================================================
// Database (module-level singleton)
// =============================================================================

const db = openDB({
  name: 'TodoApp',
  versionStrategy: 'auto',
  stores,
})

// =============================================================================
// Query Client
// =============================================================================

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 },
  },
})

// =============================================================================
// App
// =============================================================================

function TodoApp() {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')

  // Query
  const { data: todos = [], isLoading } = useQuery({
    queryKey: ['todos'],
    queryFn: async () => {
      const data = await db.todos.getAll()
      console.log('??', data);
      return data;
    },
  })
  const { data: count } = useQuery({
    queryKey: ['todos', 'completed', 'count'],
    queryFn: async () => {
      const value = await db.todos.query().index('completed').equals(true)
        .count();

      return value;
    },
  });


  // Mutations
  const addTodo = useMutation({
    mutationFn: async (title: string) => {
      await db.todos.add({ id: crypto.randomUUID(), title })
      console.log('끝남')
    },
    onSuccess: () => queryClient.refetchQueries({ queryKey: ['todos'] }),
  })

  const toggleTodo = useMutation({
    mutationFn: (todo: Todo) =>
      db.todos.put({ ...todo, completed: !todo.completed }),
    onSuccess: () => queryClient.refetchQueries({ queryKey: ['todos'] }),
  })

  const deleteTodo = useMutation({
    mutationFn: (id: string) => db.todos.delete(id),
    onSuccess: () => queryClient.refetchQueries({ queryKey: ['todos'] }),
  })


  const clear = useMutation({
    mutationFn: async () => {
      const transaction = db.startTransaction(['todos']);
      for (const todo of todos) {
        transaction.todos.put({ ...todo, completed: true });
      }
      await transaction.commit();
    },
    onSuccess: () => queryClient.refetchQueries({ queryKey: ['todos'] }),
  });


  // Handlers
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    addTodo.mutate(title.trim())
    setTitle('')
  }

  if (isLoading) return <div className="loading">Loading...</div>

  return (
    <div className="app">
      <h1>schema-idb + React Query</h1>

      <form onSubmit={handleSubmit} className="form">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs to be done?"
        />
        <button type="submit" disabled={addTodo.isPending}>
          Add
        </button>
      </form>

      <ul className="todo-list">
        {todos.map((todo: Todo) => (
          <li key={todo.id} className={todo.completed ? 'completed' : ''}>
            <label>
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => toggleTodo.mutate(todo)}
              />
              <span>{todo.title}</span>
            </label>
            <button
              className="delete"
              onClick={() => deleteTodo.mutate(todo.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {todos.length === 0 && <p className="empty">No todos yet</p>}

      <p className="stats">
        {todos.filter((t: Todo) => !t.completed).length} remaining
      </p>
      <button
        type="submit"
        disabled={clear.isPending}
        style={{ width: '100%' }}
        onClick={() => clear.mutate()}
      >
        Clear
      </button>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TodoApp />
    </QueryClientProvider>
  )
}
