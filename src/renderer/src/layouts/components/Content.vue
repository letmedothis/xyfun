<template>
  <div :class="[`${prefix}-content-container`]">
    <router-view v-if="isRouterAlive" v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <keep-alive>
          <component :is="Component" id="main-component" :key="activeRouteFullPath" :class="`${prefix}-component`" />
        </keep-alive>
      </transition>
    </router-view>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { emitterChannel } from '@/config/emitterChannel';
import { prefix } from '@/config/global';
import emitter from '@/utils/emitter';

const activeRouteFullPath = computed(() => {
  const router = useRouter();
  return router.currentRoute.value.fullPath;
});

const isRouterAlive = ref(true);

const refreshView = () => {
  isRouterAlive.value = false;
  nextTick(() => (isRouterAlive.value = true));
};

emitter.on(emitterChannel.REFRESH_VIEW, refreshView);
onUnmounted(() => emitter.off(emitterChannel.REFRESH_VIEW, refreshView));
</script>
<style lang="less" scoped>
.fade-leave-active,
.fade-enter-active {
  transition: opacity @anim-duration-slow @anim-time-fn-easing;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
