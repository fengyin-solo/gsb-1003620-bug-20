<template>
  <section class="page" :data-module="meta.key">
    <header class="page-head">
      <div>
        <h2>{{ meta.name }}管理</h2>
        <p class="page-desc">{{ meta.desc }}</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" :disabled="busy" @click="openCreate">
          登记{{ meta.entity }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出{{ meta.name }}清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">登记总量</span>
        <strong class="stat-value">{{ stats.created }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待处理</span>
        <strong class="stat-value">{{ stats.pending }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">异常量</span>
        <strong class="stat-value">{{ stats.abnormal }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已归档</span>
        <strong class="stat-value">{{ stats.archived }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in meta.fields" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in meta.fields" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in meta.actions"
              :key="action"
              class="link"
              type="button"
              :disabled="busy"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="meta.fields.length + 2" class="empty-state">
            暂无{{ meta.entity }}数据，可先登记{{ meta.entity }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条{{ meta.entity }}记录（归档清单另有 {{ stats.archived }} 条）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <EntryDialog :open="dialogOpen" :meta="meta" @close="dialogOpen = false" @saved="onSaved" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listArchiveEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { onDataChange } from '@/data/events'
import type { EntryRow } from '@/data/types'
import EntryDialog from './EntryDialog.vue'

const props = defineProps<{ moduleKey: string }>()

const meta = moduleMeta(props.moduleKey)
const filterFields = meta.fields.slice(0, 3)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const busy = ref(false)
const dialogOpen = ref(false)
const filters = reactive<Record<string, string>>({})
// 数据落库后 bump 一下，统计卡片与表格都按最新存储重算（刷新与返回结果一致）。
const tick = ref(0)

const stats = computed(() => {
  void tick.value
  const all = listEntries(meta.key).items
  return {
    created: all.length,
    pending: all.filter((row) => row.pending).length,
    abnormal: all.filter((row) => row.abnormal).length,
    archived: listArchiveEntries({ module: meta.key }).total,
  }
})

const statusSummary = computed(() => {
  void tick.value
  return meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  }))
})

function resetFilters() {
  for (const key of Object.keys(filters)) {
    filters[key] = ''
  }
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = ''
  dialogOpen.value = true
}

function onSaved() {
  dialogOpen.value = false
  reload()
}

function runAction(action: string, row: EntryRow) {
  if (busy.value) {
    // 同一动作重复提交只生效一次
    return
  }
  busy.value = true
  errorMessage.value = ''
  try {
    const result = applyAction(meta.key, Number(row.id), action)
    if (!result.ok) {
      errorMessage.value = result.message
    }
    reload()
  } finally {
    busy.value = false
  }
}

function reload() {
  tick.value += 1
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : `${meta.entity}列表读取失败`
  }
}

onMounted(reload)
const unsubscribe = onDataChange(reload)
onUnmounted(unsubscribe)
</script>
