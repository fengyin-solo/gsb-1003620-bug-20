<template>
  <div v-if="open" class="modal-mask" @click.self="close">
    <form class="modal-card" @submit.prevent="submit">
      <header class="modal-head">
        <h3>登记{{ meta.entity }}</h3>
        <button class="btn ghost" type="button" @click="close">关闭</button>
      </header>
      <div class="modal-body">
        <label v-for="field in meta.fields" :key="field" class="form-item">
          <span>{{ field }}</span>
          <input
            v-model="form[field]"
            :type="inputType(field)"
            :placeholder="placeholderOf(field)"
          />
        </label>
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
      </div>
      <footer class="modal-foot">
        <button class="btn" type="button" @click="close">取消</button>
        <button class="btn primary" type="submit" :disabled="submitting">
          {{ submitting ? '保存中…' : '保存' }}
        </button>
      </footer>
    </form>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

import { createEntry, fieldKind } from '@/api/local-service'
import type { ModuleMeta } from '@/data/types'

const props = defineProps<{ open: boolean; meta: ModuleMeta }>()
const emit = defineEmits<{
  (event: 'close'): void
  (event: 'saved'): void
}>()

const form = reactive<Record<string, string>>({})
const errorMessage = ref('')
const submitting = ref(false)

watch(
  () => props.open,
  (open) => {
    if (open) {
      for (const field of props.meta.fields) {
        form[field] = ''
      }
      errorMessage.value = ''
      submitting.value = false
    }
  },
)

function inputType(field: string): string {
  const kind = fieldKind(field)
  if (kind === 'date') {
    return 'date'
  }
  if (kind === 'number') {
    return 'number'
  }
  return 'text'
}

function placeholderOf(field: string): string {
  const kind = fieldKind(field)
  if (kind === 'date') {
    return 'YYYY-MM-DD'
  }
  return `请输入${field}`
}

function close() {
  emit('close')
}

function submit() {
  if (submitting.value) {
    // 同一次登记重复提交只生效一次
    return
  }
  submitting.value = true
  const result = createEntry(props.meta.key, { ...form })
  if (!result.ok) {
    errorMessage.value = result.message
    submitting.value = false
    return
  }
  submitting.value = false
  emit('saved')
}
</script>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  width: 560px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  padding: 16px 18px;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.modal-head h3 { margin: 0; font-size: 16px; }
.modal-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 14px;
}
.form-item span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.form-item input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.modal-body .error-text { grid-column: 1 / -1; margin: 0; }
.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
</style>
