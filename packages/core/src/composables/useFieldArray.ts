import { computed, Ref, ref, watch } from 'vue';

import toValue from './toValue';
import { useInternalContext } from './useInternalContext';
import appendAt from '../utils/append';
import insertAt from '../utils/insert';
import isString from '../utils/isString';
import moveAt from '../utils/move';
import omit from '../utils/omit';
import prependAt from '../utils/prepend';
import removeAt from '../utils/remove';
import swapAt from '../utils/swap';
import updateAt from '../utils/update';

import type {
  FieldArrayValidator,
  FieldAttrs,
  FormErrors,
  FormTouched,
  MaybeRefOrGetter,
  Primitive,
} from '../types';

interface FieldEntry<Value> {
  key: number;
  value: Value;
  name: string;
  error: FormErrors<Value>;
  touched: Value extends Primitive ? boolean : FormTouched<Value> | undefined;
  dirty: boolean;
  attrs: Omit<FieldAttrs, 'name'>;
}

export interface UseFieldArrayOptions<Value> {
  validate?: FieldArrayValidator<Value[]>;
}

type UseFieldArrayReturn<Value> = {
  fields: Ref<FieldEntry<Value>[]>;
  append: (value: Value) => void;
  prepend: (value: Value) => void;
  swap: (indexA: number, indexB: number) => void;
  remove: (index?: number) => void;
  move: (from: number, to: number) => void;
  insert: (index: number, value: Value) => void;
  update: (index: number, value: Value) => void;
  replace: (values: Value[]) => void;
};

/**
 * Custom composition API that exposes convenient to perform operations with a list of fields.
 *
 * @param name - field name
 *
 * @param options - field array configuration and validation parameters {@link UseFieldArrayOptions}
 *
 * @returns fields state and methods. {@link UseFieldArrayReturn}
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { useForm, useFieldArray } from '@vorms/core';
 *
 * const { values, handleSubmit } = useForm({
 *   initialValues: {
 *     list: ['vue', 'vue-router'],
 *   },
 *   onSubmit(values) {
 *     console.log({ values });
 *   },
 * });
 *
 * const { fields, append } = useFieldArray('list');
 * </script>
 *
 * <template>
 *   <pre>{{ values }}</pre>
 *   <form v-on:submit="handleSubmit">
 *     <template v-for="field in fields" :key="field.key">
 *       <input v-model="field.value" :name="field.name" v-bind="field.attrs" />
 *     </template>
 *     <button type="button" v-on:click="append('pinia')">Append</button>
 *     <input type="submit" />
 *   </form>
 * </template>
 * ```
 */
export function useFieldArray<Value>(
  name: MaybeRefOrGetter<string>,
  options?: UseFieldArrayOptions<Value>,
): UseFieldArrayReturn<Value> {
  const {
    getFieldValue,
    setFieldValue,
    getFieldError,
    getFieldTouched,
    getFieldDirty,
    getFieldAttrs,
    registerFieldArray,
    setFieldArrayValue,
  } = useInternalContext();

  const fields: Ref<FieldEntry<Value>[]> = ref([]);
  const values = computed(() => {
    return getFieldValue(name).value || [];
  });

  let seed = 0;
  const reset = () => {
    fields.value = values.value.map(createEntry);
  };

  const createEntry = (value: Value) => {
    const key = seed++;

    const index = computed(() =>
      fields.value.findIndex((field) => field.key === key),
    );

    const nameGetter = () => `${toValue(name)}.${index.value}`;

    return {
      key,
      value: computed<Value>({
        get() {
          return index.value === -1 ? value : values.value[index.value];
        },
        set(value) {
          if (index.value === -1) return;
          setFieldValue(nameGetter, value);
        },
      }),

      name: computed(nameGetter),
      error: computed(() => getFieldError(nameGetter)),
      touched: computed(() => getFieldTouched(nameGetter)),
      dirty: computed(() => getFieldDirty(nameGetter)),
      attrs: computed(() => omit(getFieldAttrs(nameGetter).value, 'name')),
    } as any as FieldEntry<Value>; // `computed` will be auto unwrapped
  };

  const append = (value: Value) => {
    setFieldArrayValue(toValue(name), appendAt(values.value, value), appendAt, {
      argA: undefined,
    });

    fields.value.push(createEntry(value));
  };

  const prepend = (value: Value) => {
    setFieldArrayValue(
      toValue(name),
      prependAt(values.value, value),
      prependAt,
      {
        argA: undefined,
      },
    );

    fields.value.unshift(createEntry(value));
  };

  const remove = (index?: number) => {
    const cloneValues = removeAt(values.value, index);
    const cloneField = removeAt(fields.value, index);

    setFieldArrayValue(toValue(name), cloneValues, removeAt, {
      argA: index,
    });

    fields.value = cloneField;
  };

  const swap = (indexA: number, indexB: number) => {
    if (!(indexA in values.value) || !(indexB in values.value)) return;

    const cloneValues = [...values.value];
    const cloneField = [...fields.value];

    swapAt(cloneValues, indexA, indexB);
    swapAt(cloneField, indexA, indexB);

    setFieldArrayValue(
      toValue(name),
      cloneValues,
      swapAt,
      {
        argA: indexA,
        argB: indexB,
      },
      false,
    );

    fields.value = cloneField;
  };

  const move = (from: number, to: number) => {
    if (!(from in values.value)) return;

    const cloneValues = [...values.value];
    const cloneField = [...fields.value];

    moveAt(cloneValues, from, to);
    moveAt(cloneField, from, to);

    setFieldArrayValue(
      toValue(name),
      cloneValues,
      moveAt,
      {
        argA: from,
        argB: to,
      },
      false,
    );

    fields.value = cloneField;
  };

  const insert = (index: number, value: Value) => {
    const cloneValues = insertAt(values.value, index, value);
    const cloneField = insertAt(fields.value, index, createEntry(value));

    setFieldArrayValue(toValue(name), cloneValues, insertAt, {
      argA: index,
      argB: undefined,
    });

    fields.value = cloneField;
  };

  const update = (index: number, value: Value) => {
    if (!(index in values.value)) return;

    const cloneValue = updateAt(values.value, index, value);

    setFieldArrayValue(toValue(name), cloneValue, updateAt, {
      argA: index,
      argB: undefined,
    });

    fields.value[index].value = value;
  };

  const replace = (values: Value[]) => {
    const cloneValues = [...values];

    setFieldArrayValue(toValue(name), cloneValues, <T>(data: T): T => data, {});

    fields.value = cloneValues.map(createEntry);
  };

  registerFieldArray(name, {
    ...options,
    reset,
  });

  if (!isString(name)) {
    watch(name, reset, {
      flush: 'sync',
    });
  }

  reset();

  return {
    fields,
    append,
    prepend,
    swap,
    remove,
    move,
    insert,
    update,
    replace,
  };
}
