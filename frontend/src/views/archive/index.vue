<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>归档清单</h2>
        <p class="page-desc">
          各模块进入终态的记录整体移入此处，与模块台账、运营概览同次落库；异常量按同一口径判定，不与台账重复。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">刷新清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">归档总量</span>
        <strong class="stat-value">{{ total }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">其中异常</span>
        <strong class="stat-value">{{ abnormalCount }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>业务模块</span>
        <select v-model="moduleFilter">
          <option value="">全部模块</option>
          <option v-for="item in modules" :key="item.key" :value="item.key">{{ item.name }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>关键字</span>
        <input v-model="keyword" placeholder="按记录字段检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>业务模块</th>
          <th>记录编号</th>
          <th>归档时状态</th>
          <th>触发动作</th>
          <th>归档时间</th>
          <th>是否异常</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in items" :key="`${row.归档模块}-${row.id}`">
          <td>{{ moduleName(row.归档模块) }}</td>
          <td>{{ row.id }}</td>
          <td>{{ row.status }}</td>
          <td>{{ row.归档动作 }}</td>
          <td>{{ formatTime(row.归档时间) }}</td>
          <td>{{ row.abnormal ? '异常' : '正常' }}</td>
        </tr>
        <tr v-if="!items.length">
          <td colspan="6" class="empty-state">暂无归档记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条归档记录</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { listArchiveEntries } from '@/api/local-service'
import { onDataChange } from '@/data/events'
import { MODULES } from '@/data/modules'
import { classifyStatus } from '@/data/rules'
import type { ArchiveRow } from '@/data/types'

const modules = MODULES
const moduleFilter = ref('')
const keyword = ref('')
const items = ref<ArchiveRow[]>([])
const total = ref(0)

const abnormalCount = computed(() =>
  items.value.filter((row) => classifyStatus(row.归档模块, String(row.status)).abnormal).length,
)

function moduleName(key: string): string {
  return MODULES.find((item) => item.key === key)?.name ?? key
}

function formatTime(raw: string): string {
  if (!raw) {
    return '历史数据补算'
  }
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) {
    return raw
  }
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function resetFilters() {
  moduleFilter.value = ''
  keyword.value = ''
  reload()
}

function reload() {
  const payload = listArchiveEntries({
    module: moduleFilter.value || undefined,
    keyword: keyword.value || undefined,
  })
  items.value = payload.items
  total.value = payload.total
}

onMounted(() => {
  reload()
})
const unsubscribe = onDataChange(reload)
onUnmounted(unsubscribe)
</script>
