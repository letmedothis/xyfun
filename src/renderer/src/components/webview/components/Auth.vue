<template>
  <t-dialog
    v-model:visible="isVisible"
    show-in-attached-element
    :attach="props.attach"
    placement="center"
    destroy-on-close
    :close-on-esc-keydown="false"
    :close-on-overlay-click="false"
    lazy
    @close="handleReset"
  >
    <template #header>
      {{ $t('common.auth') }}
    </template>
    <template #body>
      <t-form
        ref="formRef"
        :data="formData"
        :rules="RULES"
        :label-width="80"
        required-mark-position="right"
        label-align="left"
        reset-type="initial"
        @submit="onSubmit"
      >
        <t-form-item :label="t('common.username')" name="username">
          <t-input v-model="formData.username" />
        </t-form-item>
        <t-form-item :label="t('common.password')" name="password">
          <t-input v-model="formData.password" type="password" />
        </t-form-item>
      </t-form>
    </template>
    <template #footer>
      <t-button theme="default" variant="base" @click="handleReset">{{ $t('common.reset') }}</t-button>
      <t-button theme="primary" variant="base" @click="handleSubmit">{{ $t('common.confirm') }}</t-button>
    </template>
  </t-dialog>
</template>
<script lang="ts" setup>
defineOptions({
  name: 'WebviewAuth',
});

const props = defineProps({
  attach: {
    type: String,
    default: 'body',
  },
});

const emits = defineEmits(['submit']);

import { IPC_CHANNEL } from '@shared/config/ipcChannel';
import type { IAuthCert, IAuthSendPayload } from '@shared/types/auth';
import type { FormInstanceFunctions, SubmitContext } from 'tdesign-vue-next';
import { MessagePlugin } from 'tdesign-vue-next';
import { onMounted, onUnmounted, ref, toRaw, useTemplateRef } from 'vue';

import { t } from '@/locales';

const RULES = {
  username: [],
  password: [],
};

const formRef = useTemplateRef<FormInstanceFunctions>('formRef');

const isVisible = ref<boolean>(false);
const formData = ref<IAuthCert>({
  username: '',
  password: '',
});
const authPayload = ref<IAuthSendPayload | null>(null);

onMounted(() => setup());
onUnmounted(() => {
  window.electron.ipcRenderer.removeAllListeners(IPC_CHANNEL.LOGIN_BASIC);
});

const setup = async () => {
  loginBasic();
};

const loginBasic = async () => {
  window.electron.ipcRenderer.on(IPC_CHANNEL.LOGIN_BASIC, (_, payload: IAuthSendPayload) => {
    authPayload.value = payload;
    isVisible.value = true;
  });
};

const handleExecute = () => {
  const { username = '', password = '' } = formData.value;
  const authPayloadRaw = toRaw(authPayload.value);
  const authCert: IAuthCert = { username, password };

  const doc = { ...authPayloadRaw, authCert };

  window.electron.ipcRenderer.send(IPC_CHANNEL.LOGIN_BASIC_RELAY, doc);
  emits('submit', doc);

  handleReset();
  isVisible.value = false;
};

const onSubmit = (context: SubmitContext<FormData>) => {
  const { validateResult, firstError } = context;
  if (validateResult && typeof validateResult === 'boolean') {
    handleExecute();
  } else {
    MessagePlugin.warning(firstError!);
  }
};

const handleSubmit = () => {
  formRef.value?.submit();
};

const handleReset = () => {
  formRef.value?.reset();
  authPayload.value = null;
};
</script>
