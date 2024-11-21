import deepmerge from 'deepmerge';
import isEqual from 'fast-deep-equal/es6';
import { klona as deepClone } from 'klona/full';
import { computed, onMounted, provide, reactive, ref, unref } from 'vue';

import toValue from './toValue';
import { FormContextKey } from './useFormContext';
import useFormStore from './useFormStore';
import { InternalContextKey } from './useInternalContext';
import get from '../utils/get';
import isFunction from '../utils/isFunction';
import isPromise from '../utils/isPromise';
import isString from '../utils/isString';
import keysOf from '../utils/keysOf';
import set from '../utils/set';

import type { Reducer } from './useFormStore';
import type { InternalContextValues } from './useInternalContext';
import type {
  FieldAttrs,
  FieldError,
  FieldMeta,
  FieldValidator,
  FormErrors,
  FormEventHandler,
  FormResetState,
  FormState,
  FormTouched,
  FormValues,
  MaybeRefOrGetter,
  Path,
  PathValue,
  ResetForm,
  SetFieldArrayValue,
  UseFormRegister,
  UseFormReturn,
  UseFormSetFieldError,
  UseFormSetFieldTouched,
  ValidateField,
} from '../types';

interface FieldRegistry {
  [field: string]: {
    validate: FieldValidator<FormValues>;
  };
}

interface FieldArrayRegistry {
  [field: string]: {
    reset: () => void;
  };
}

interface ValidateHandlerOptions {
  onlyBlurred?: boolean;
}

export interface FormSubmitHelper<Values extends FormValues> {
  setSubmitting: (isSubmitting: boolean) => void;
  readonly initialValues: Values;
}

export type ValidateMode = 'blur' | 'input' | 'change' | 'submit';

export interface UseFormOptions<
  Values extends FormValues,
  ValidatedValues extends FormValues | undefined = undefined,
> {
  initialValues: Values;
  initialErrors?: FormErrors<Values>;
  initialTouched?: FormTouched<Values>;
  validateMode?: ValidateMode;
  reValidateMode?: ValidateMode;
  validateOnMounted?: boolean;
  onSubmit: (
    values: ValidatedValues extends FormValues ? ValidatedValues : Values,
    helper: FormSubmitHelper<Values>,
  ) => void | Promise<any>;
  onInvalid?: (errors: FormErrors<Values>) => void;
  validate?: (values: Values) => void | object | Promise<FormErrors<Values>>;
}

const enum ACTION_TYPE {
  SUBMIT_ATTEMPT,
  SUBMIT_SUCCESS,
  SUBMIT_FAILURE,
  SET_VALUES,
  SET_FIELD_VALUE,
  SET_TOUCHED,
  SET_ERRORS,
  SET_FIELD_ERROR,
  SET_ISSUBMITTING,
  SET_ISVALIDATING,
  RESET_FORM,
}

type FormMessage<Values extends FormValues> =
  | { type: ACTION_TYPE.SUBMIT_ATTEMPT }
  | { type: ACTION_TYPE.SUBMIT_SUCCESS }
  | { type: ACTION_TYPE.SUBMIT_FAILURE }
  | { type: ACTION_TYPE.SET_VALUES; payload: Values }
  | { type: ACTION_TYPE.SET_FIELD_VALUE; payload: { path: string; value: any } }
  | {
      type: ACTION_TYPE.SET_TOUCHED;
      payload: { path: string; touched?: boolean };
    }
  | { type: ACTION_TYPE.SET_ERRORS; payload: FormErrors<Values> }
  | {
      type: ACTION_TYPE.SET_FIELD_ERROR;
      payload: {
        path: string;
        error: FieldError<PathValue<Values, Path<Values>>> | string | string[];
      };
    }
  | { type: ACTION_TYPE.SET_ISSUBMITTING; payload: boolean }
  | { type: ACTION_TYPE.SET_ISVALIDATING; payload: boolean }
  | { type: ACTION_TYPE.RESET_FORM; payload: FormResetState<Values> };

function reducer<Values extends FormValues>(
  state: FormState<Values>,
  message: FormMessage<Values>,
) {
  switch (message.type) {
    case ACTION_TYPE.SUBMIT_ATTEMPT:
      state.isSubmitting.value = true;
      state.submitCount.value = state.submitCount.value + 1;
      return;
    case ACTION_TYPE.SUBMIT_SUCCESS:
      state.isSubmitting.value = false;
      return;
    case ACTION_TYPE.SUBMIT_FAILURE:
      state.isSubmitting.value = false;
      return;
    case ACTION_TYPE.SET_VALUES:
      keysOf(state.values).forEach((key) => {
        delete state.values[key];
      });

      keysOf(message.payload).forEach((path) => {
        (state.values as Values)[path] = message.payload[path];
      });
      return;
    case ACTION_TYPE.SET_FIELD_VALUE:
      set(state.values, message.payload.path, deepClone(message.payload.value));
      return;
    case ACTION_TYPE.SET_TOUCHED:
      set(state.touched.value, message.payload.path, message.payload.touched);
      return;
    case ACTION_TYPE.SET_ERRORS:
      state.errors.value = message.payload;
      return;
    case ACTION_TYPE.SET_FIELD_ERROR:
      set(state.errors.value, message.payload.path, message.payload.error);
      return;
    case ACTION_TYPE.SET_ISSUBMITTING:
      state.isSubmitting.value = message.payload;
      return;
    case ACTION_TYPE.SET_ISVALIDATING:
      state.isValidating.value = message.payload;
      return;
    case ACTION_TYPE.RESET_FORM:
      reducer(state, {
        type: ACTION_TYPE.SET_VALUES,
        payload: message.payload.values,
      });

      state.touched.value = message.payload.touched;
      state.errors.value = message.payload.errors;
      state.submitCount.value = message.payload.submitCount;
  }
}

const emptyErrors: FormErrors<unknown> = {};
const emptyTouched: FormTouched<unknown> = {};

/**
 * Custom composition API to mange the entire form.
 *
 * @param options - form configuration and validation parameters. {@link UseFormOptions}
 *
 * @returns methods and state of this form. {@link UseFormReturn}
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * const { register, handleSubmit } = useForm({
 *   initialValues: {
 *     name: 'Alex',
 *     age: 18,
 *   },
 *   onSubmit (values) {
 *     console.log({ values })
 *   },
 * });
 *
 * const { value: name, attrs: nameAttrs } = register('name')
 * const { value: age, attrs: ageAttrs } = register('name')
 * </script>
 *
 * <template>
 *   <form v-on:submit="handleSubmit">
 *     <input v-model="name" type="text" v-bind="nameAttrs" />
 *     <input v-model.number="age" type="text" v-bind="ageAttrs" />
 *     <input type="submit" />
 *   </form>
 * </template>
 * ```
 */
export function useForm<
  Values extends FormValues = FormValues,
  ValidatedValues extends FormValues | undefined = undefined,
>(options: UseFormOptions<Values, ValidatedValues>): UseFormReturn<Values> {
  const {
    validateOnMounted = false,
    validateMode = 'submit',
    reValidateMode = 'change',
    onSubmit,
    onInvalid,
  } = options;

  let initialValues = deepClone(options.initialValues);
  let initialErrors = deepClone(options.initialErrors || emptyErrors);
  let initialTouched = deepClone(options.initialTouched || emptyTouched);

  const [state, dispatch] = useFormStore<
    Reducer<FormState<Values>, FormMessage<Values>>
  >(reducer, {
    values: reactive(deepClone(initialValues)),
    errors: ref(deepClone(initialErrors)),
    touched: ref(deepClone(initialTouched)),
    submitCount: ref(0),
    isSubmitting: ref(false),
    isValidating: ref(false),
  });

  const fieldRegistry: FieldRegistry = {};
  const fieldArrayRegistry: FieldArrayRegistry = {};

  const dirty = computed(() => !isEqual(state.values, initialValues));
  const validateTiming = computed(() =>
    state.submitCount.value === 0 ? validateMode : reValidateMode,
  );

  const registerField = (
    name: MaybeRefOrGetter<string>,
    { validate }: any = {},
  ) => {
    if (validate) {
      fieldRegistry[toValue(name)] = {
        validate,
      };
    }
  };

  const registerFieldArray = (name: MaybeRefOrGetter<string>, options: any) => {
    registerField(name, options);

    fieldArrayRegistry[toValue(name)] = {
      reset: options.reset,
    };
  };

  const setFieldTouched: UseFormSetFieldTouched<Values> = (
    name,
    touched = true,
  ) => {
    dispatch({
      type: ACTION_TYPE.SET_TOUCHED,
      payload: {
        path: name,
        touched,
      },
    });

    return validateTiming.value === 'blur'
      ? runAllValidateHandler(state.values, { onlyBlurred: true })
      : Promise.resolve();
  };

  const setValues = (values: Values, shouldValidate?: boolean) => {
    dispatch({
      type: ACTION_TYPE.SET_VALUES,
      payload: values,
    });

    const willValidate =
      shouldValidate == null
        ? validateTiming.value === 'change'
        : shouldValidate;

    return willValidate
      ? runAllValidateHandler(state.values)
      : Promise.resolve();
  };

  const setFieldValue = (
    name: MaybeRefOrGetter<string>,
    value: any,
    shouldValidate?: boolean,
  ) => {
    dispatch({
      type: ACTION_TYPE.SET_FIELD_VALUE,
      payload: {
        path: toValue(name),
        value,
      },
    });

    return shouldValidate
      ? runAllValidateHandler(state.values)
      : Promise.resolve();
  };

  const setFieldArrayValue: SetFieldArrayValue<Values> = (
    name,
    value,
    method,
    args,
    shouldSetValue = true,
  ) => {
    if (method && args) {
      if (
        keysOf(state.errors.value).length &&
        Array.isArray(get(state.errors.value, name))
      ) {
        const error = method(
          get(state.errors.value, name),
          args.argA,
          args.argB,
        );

        if (shouldSetValue) {
          setFieldError(name, error);
        }
      }

      if (
        keysOf(state.touched.value).length &&
        Array.isArray(get(state.touched.value, name))
      ) {
        const touched = method(
          get(state.touched.value, name),
          args.argA,
          args.argB,
        );

        if (shouldSetValue) {
          dispatch({
            type: ACTION_TYPE.SET_TOUCHED,
            payload: {
              path: name,
              touched,
            },
          });
        }
      }
    }

    return setFieldValue(name, value);
  };

  const setErrors = (errors: FormErrors<Values>) => {
    dispatch({
      type: ACTION_TYPE.SET_ERRORS,
      payload: errors,
    });
  };

  const setFieldError: UseFormSetFieldError<Values> = (name, error) => {
    dispatch({
      type: ACTION_TYPE.SET_FIELD_ERROR,
      payload: {
        path: name,
        error,
      },
    });
  };

  const handleBlur: FormEventHandler<Path<Values>>['handleBlur'] = (
    eventOrName,
    path,
  ) => {
    const isPath = (value: any): value is Path<Values> => isString(value);

    if (isPath(eventOrName)) {
      return () => setFieldTouched(eventOrName, true);
    }

    const { name, id } = eventOrName.target as HTMLInputElement;
    const field = path ?? ((name || id) as Path<Values>);

    if (field) {
      return setFieldTouched(field, true);
    }
  };

  const handleChange: FormEventHandler['handleChange'] = () => {
    if (validateTiming.value === 'change') {
      runAllValidateHandler(state.values);
    }
  };

  const handleInput: FormEventHandler['handleInput'] = () => {
    if (validateTiming.value === 'input') {
      runAllValidateHandler(state.values);
    }
  };

  const setSubmitting = (isSubmitting: boolean) => {
    dispatch({ type: ACTION_TYPE.SET_ISSUBMITTING, payload: isSubmitting });
  };

  const getFieldValue = (name: MaybeRefOrGetter<string>) => {
    return computed<any>({
      get() {
        return get(state.values, toValue(name));
      },
      set(value) {
        setFieldValue(name, value);
      },
    });
  };

  const getFieldMeta = <
    Name extends Path<Values>,
    Value = PathValue<Values, Name>,
  >(
    name: MaybeRefOrGetter<Name>,
  ): FieldMeta<Value> => {
    const error = computed(() => getFieldError(name));
    const touched = computed(() => getFieldTouched(name));
    const dirty = computed(() => getFieldDirty(name));

    return {
      dirty,
      error,
      touched,
    };
  };

  const getFieldAttrs = (name: MaybeRefOrGetter<string>) => {
    return computed<FieldAttrs>(() => ({
      name: toValue(name),
      onBlur: handleBlur,
      onChange: handleChange,
      onInput: handleInput,
    }));
  };

  const getFieldError = <
    Name extends Path<Values>,
    Value = PathValue<Values, Name>,
  >(
    name: MaybeRefOrGetter<Name>,
  ): FieldError<Value> => {
    name = toValue(name);
    return get(state.errors.value, name);
  };

  const getFieldTouched = (
    name: MaybeRefOrGetter<string>,
  ): FormTouched<boolean> => {
    name = toValue(name);
    return get(state.touched.value, name, false);
  };

  const getFieldDirty = (name: MaybeRefOrGetter<string>): boolean => {
    name = toValue(name);
    return !isEqual(get(initialValues, name), get(state.values, name));
  };

  const submitHelper: FormSubmitHelper<Values> = {
    setSubmitting,
    get initialValues() {
      return deepClone(initialValues);
    },
  };

  const runSingleFieldValidateHandler = <
    Name extends Path<Values>,
    Value extends PathValue<Values, Name>,
  >(
    name: Name,
    value: Value,
  ) => {
    return Promise.resolve(fieldRegistry[name].validate(value));
  };

  const runFieldValidateHandler = (values: Values) => {
    const fieldKeysWithValidation = keysOf(fieldRegistry).filter((field) =>
      isFunction(fieldRegistry[field].validate),
    ) as Path<Values>[];

    const fieldValidatePromise = fieldKeysWithValidation.map((field) =>
      runSingleFieldValidateHandler(field, get(values, field)),
    );

    return Promise.all(fieldValidatePromise).then((errors) =>
      errors.reduce((prev: FormErrors<Values>, curr, index) => {
        if (curr) {
          set(prev, fieldKeysWithValidation[index], curr);
        }
        return prev;
      }, {}),
    );
  };

  const runValidateHandler = (values: Values) => {
    return new Promise<FormErrors<Values>>((resolve) => {
      const maybePromise = options.validate?.(values);
      if (maybePromise == null) {
        resolve({});
      } else if (isPromise(maybePromise)) {
        maybePromise.then((error) => {
          resolve(error || {});
        });
      } else {
        resolve(maybePromise);
      }
    });
  };

  /**
   * Creates a new object of errors, but only with the errors of touched fields.
   *
   * @param errors The union of field and form errors
   * @returns The field errors that have been touched
   */
  const getTouchedErrors = <
    T extends FormErrors<Values>,
    F extends FormTouched<Values>,
  >(
    errors: T,
    touched: F,
  ): Partial<T> => {
    const result: any = {};

    for (const key in errors) {
      if (typeof touched[key] === 'object' && typeof errors[key] === 'object') {
        result[key] = getTouchedErrors(
          errors[key] as FormErrors<Values>,
          touched[key] as FormTouched<Values>,
        );
      } else if (touched[key] === true && errors[key]) {
        result[key] = errors[key];
      }
    }

    return result;
  };

  const runAllValidateHandler = (
    values: Values = state.values,
    validateOptions?: ValidateHandlerOptions,
  ) => {
    dispatch({ type: ACTION_TYPE.SET_ISVALIDATING, payload: true });
    return Promise.all([
      runFieldValidateHandler(values),
      options.validate ? runValidateHandler(values) : {},
    ])
      .then(([fieldErrors, validateErrors]) => {
        const baseErrors = deepmerge.all<FormErrors<Values>>(
          [fieldErrors, validateErrors],
          {
            arrayMerge,
          },
        );

        const errors = validateOptions?.onlyBlurred
          ? getTouchedErrors(baseErrors, unref(state.touched))
          : baseErrors;

        setErrors(errors);

        return errors;
      })
      .finally(() => {
        dispatch({ type: ACTION_TYPE.SET_ISVALIDATING, payload: false });
      });
  };

  const handleSubmit = (event?: Event) => {
    event?.preventDefault();

    dispatch({ type: ACTION_TYPE.SUBMIT_ATTEMPT });

    runAllValidateHandler().then((errors) => {
      const isValid = keysOf(errors).length === 0;

      if (isValid) {
        const maybePromise = onSubmit(
          deepClone(state.values) as ValidatedValues extends FormValues
            ? ValidatedValues
            : Values,
          submitHelper,
        );
        if (maybePromise == null) {
          return;
        }

        maybePromise
          .then((result) => {
            dispatch({ type: ACTION_TYPE.SUBMIT_SUCCESS });
            return result;
          })
          .catch(() => {
            dispatch({ type: ACTION_TYPE.SUBMIT_FAILURE });
          });
      } else {
        dispatch({ type: ACTION_TYPE.SUBMIT_FAILURE });
        onInvalid?.(errors);
      }
    });
  };

  const resetForm: ResetForm<Values> = (nextState) => {
    const values = deepClone(nextState?.values || initialValues);
    const errors = deepClone(nextState?.errors || initialErrors);
    const touched = deepClone(nextState?.touched || initialTouched);

    initialValues = deepClone(values);
    initialErrors = deepClone(errors);
    initialTouched = deepClone(touched);

    dispatch({
      type: ACTION_TYPE.RESET_FORM,
      payload: {
        values,
        touched,
        errors,
        submitCount:
          typeof nextState?.submitCount === 'number'
            ? nextState.submitCount
            : 0,
      },
    });

    // reset `fields` of `useFieldArray`
    Object.values(fieldArrayRegistry).forEach((field) => {
      field.reset();
    });
  };

  const handleReset = (event?: Event) => {
    event?.preventDefault();

    resetForm();
  };

  const register: UseFormRegister<Values> = (name, options) => {
    registerField(name, options);

    return {
      value: getFieldValue(name),
      attrs: getFieldAttrs(name),
      ...getFieldMeta(name),
    };
  };

  const validateField: ValidateField<Values> = async (name) => {
    if (fieldRegistry[name] && isFunction(fieldRegistry[name].validate)) {
      dispatch({ type: ACTION_TYPE.SET_ISVALIDATING, payload: true });

      const value = get(state.values, name) as PathValue<Values, typeof name>;
      const error = (await runSingleFieldValidateHandler(
        name,
        value,
      )) as FieldError<PathValue<Values, typeof name>>;

      setFieldError(name, error);
      dispatch({ type: ACTION_TYPE.SET_ISVALIDATING, payload: false });

      return error;
    }
    return Promise.resolve();
  };

  const context = {
    values: state.values,
    touched: computed(() => state.touched.value),
    errors: computed(() => state.errors.value),
    submitCount: computed(() => state.submitCount.value),
    isSubmitting: state.isSubmitting,
    isValidating: computed(() => state.isValidating.value),
    dirty,
    register,
    setValues,
    setFieldValue,
    setErrors,
    setFieldError,
    setFieldTouched,
    handleSubmit,
    handleReset,
    resetForm,
    validateForm: runAllValidateHandler,
    validateField,
  };

  provide<InternalContextValues<Values>>(InternalContextKey, {
    getFieldValue,
    setFieldValue,
    getFieldError,
    getFieldTouched,
    getFieldDirty,
    getFieldAttrs,
    registerFieldArray,
    setFieldArrayValue,
    setFieldTouched,
    register,
  });

  provide<UseFormReturn<Values>>(FormContextKey, context);

  onMounted(() => {
    if (!validateOnMounted) return;
    runAllValidateHandler(initialValues);
  });

  return context;
}

/**
 * deepmerge array merging algorithm
 * https://github.com/TehShrike/deepmerge#arraymerge-example-combine-arrays
 */
function arrayMerge<T extends any[]>(target: T, source: T, options: any) {
  const destination = [...target];

  source.forEach((item, index) => {
    if (typeof destination[index] === 'undefined') {
      destination[index] = options.cloneUnlessOtherwiseSpecified(item, options);
    } else if (options.isMergeableObject(item)) {
      destination[index] = deepmerge(target[index], item, options);
    } else if (target.indexOf(item) === -1) {
      destination.push(item);
    }
  });
  return destination;
}
