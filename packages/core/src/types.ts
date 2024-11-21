import { ComputedRef, Ref, WritableComputedRef } from 'vue';

export type MaybeRef<T> = T | Ref<T>;
export type MaybeRefOrGetter<T> = MaybeRef<T> | (() => T);
export type MaybePromise<T> = T | Promise<T>;

export type FormValues = Record<string, any>;

export type FieldValidator<Value> = (
  value: Value,
) => MaybePromise<FieldError<Value>>;

export type FieldArrayValidator<Value extends Array<any>> = (
  value: Value,
) => MaybePromise<FormErrors<Value> | void>;

export type FormTouched<Values> = {
  [K in keyof Values]?: Values[K] extends any[]
    ? Values[K][number] extends object
      ? FormTouched<Values[K][number]>[] | boolean
      : boolean | boolean[]
    : Values[K] extends object
    ? FormTouched<Values[K]>
    : boolean;
};

export type FormErrors<Values> = {
  [K in keyof Values]?: Values[K] extends any[]
    ? Values[K][number] extends object
      ? FormErrors<Values[K][number]>[] | string | string[]
      : string | string[]
    : Values[K] extends object
    ? FormErrors<Values[K]> | string | string[]
    : string | string[];
};

export type FieldError<Value> = Value extends Primitive
  ? string | string[] | undefined
  : string | string[] | FormErrors<Value> | undefined;

export interface FormState<Values extends FormValues> {
  values: Values;
  touched: Ref<FormTouched<Values>>;
  errors: Ref<FormErrors<Values>>;
  submitCount: Ref<number>;
  isSubmitting: Ref<boolean>;
  isValidating: Ref<boolean>;
}

export interface FormEventHandler<S = string> {
  handleBlur: (event: Event | S, name?: S) => void;
  handleChange: () => void;
  handleInput: () => void;
}

export interface FieldRegisterOptions<Values> {
  validate?: FieldValidator<Values>;
}

export type UseFormRegisterReturn<Value> = FieldMeta<Value> & {
  value: WritableComputedRef<Value>;
  attrs: ComputedRef<FieldAttrs>;
  validateField(): Promise<void>;
};

export type SetFieldArrayValue<Values extends FormValues> = <
  Name extends Path<Values>,
  T extends (...args: any) => any,
>(
  name: Name,
  value: any[],
  method?: T,
  args?: Partial<{
    argA: Parameters<T>[1];
    argB: Parameters<T>[2];
  }>,
  shouldSetValue?: boolean,
) => void;

export type UseFormRegister<Values extends FormValues> = <
  Name extends Path<Values>,
  Value = PathValue<Values, Name>,
>(
  name: MaybeRefOrGetter<Name>,
  options?: FieldRegisterOptions<Value>,
) => UseFormRegisterReturn<Value>;

export type UseFormSetFieldValue<Values extends FormValues> = <
  Name extends Path<Values>,
  FieldValue extends PathValue<Values, Name>,
>(
  name: MaybeRefOrGetter<Name>,
  value: FieldValue,
  shouldValidate?: boolean,
) => void;

export type ValidateForm<Values extends FormValues> = (
  values?: Values,
) => Promise<FormErrors<Values>>;

export type ValidateField<Values extends FormValues> = <
  Name extends Path<Values>,
>(
  name: Name,
) => Promise<FieldError<PathValue<Values, Name>> | void>;

export type UseFormSetFieldError<Values extends FormValues> = <
  Name extends Path<Values>,
>(
  name: Name,
  error: FieldError<PathValue<Values, Name>>,
) => void;

export type UseFormSetFieldTouched<Values extends FormValues> = <
  Name extends Path<Values>,
>(
  name: Name,
  touched: boolean,
) => void;

export interface FormResetState<Values extends FormValues = FormValues> {
  values: Values;
  touched: FormTouched<Values>;
  errors: FormErrors<Values>;
  submitCount: number;
}

export type ResetForm<Values extends FormValues> = (
  nextState?: Partial<FormResetState<Values>>,
) => void;

export interface UseFormReturn<Values extends FormValues> {
  values: Values;
  touched: ComputedRef<FormTouched<Values>>;
  errors: ComputedRef<FormErrors<Values>>;
  submitCount: ComputedRef<number>;
  isSubmitting: Ref<boolean>;
  isValidating: ComputedRef<boolean>;
  dirty: ComputedRef<boolean>;
  register: UseFormRegister<Values>;
  setValues: (values: Values, shouldValidate?: boolean) => void;
  setFieldValue: UseFormSetFieldValue<Values>;
  setErrors: (errors: FormErrors<Values>) => void;
  setFieldError: UseFormSetFieldError<Values>;
  setFieldTouched: UseFormSetFieldTouched<Values>;
  handleSubmit: (event?: Event) => void;
  handleReset: (event?: Event) => void;
  resetForm: ResetForm<Values>;
  validateForm: ValidateForm<Values>;
  validateField: ValidateField<Values>;
}

export type FieldAttrs = {
  name: string;
  onBlur: (event: Event) => void;
  onChange: () => void;
  onInput: () => void;
};

export type FieldMeta<Value> = {
  dirty: ComputedRef<boolean>;
  error: ComputedRef<FieldError<Value>>;
  touched: ComputedRef<boolean | undefined>;
};

export type Primitive =
  | null
  | undefined
  | string
  | number
  | boolean
  | symbol
  | bigint;

export type IsTuple<T extends ReadonlyArray<any>> = number extends T['length']
  ? false
  : true;

type PathImpl<K extends string | number, V> = V extends Primitive
  ? `${K}`
  : `${K}` | `${K}.${Path<V>}`;

export type TupleKeys<T extends ReadonlyArray<any>> = Exclude<
  keyof T,
  keyof any[]
>;

export type Path<T> = T extends ReadonlyArray<infer V>
  ? IsTuple<T> extends true
    ? {
        [K in TupleKeys<T>]-?: PathImpl<K & string, T[K]>;
      }[TupleKeys<T>]
    : PathImpl<number, V>
  : {
      [K in keyof T]-?: PathImpl<K & string, T[K]>;
    }[keyof T];

type ArrayPathImpl<K extends string | number, V> = V extends Primitive
  ? never
  : V extends ReadonlyArray<infer U>
  ? U extends Primitive
    ? never
    : `${K}` | `${K}.${ArrayPath<V>}`
  : `${K}.${ArrayPath<V>}`;

export type ArrayPath<T> = T extends ReadonlyArray<infer V>
  ? IsTuple<T> extends true
    ? {
        [K in TupleKeys<T>]-?: ArrayPathImpl<K & string, T[K]>;
      }[TupleKeys<T>]
    : ArrayPathImpl<number, V>
  : {
      [K in keyof T]-?: ArrayPathImpl<K & string, T[K]>;
    }[keyof T];

export type PathValue<T, P extends Path<T> | ArrayPath<T>> = T extends any
  ? P extends `${infer Key}.${infer Rest}`
    ? Key extends keyof T
      ? Rest extends Path<T[Key]>
        ? PathValue<T[Key], Rest>
        : never
      : Key extends `${number}`
      ? T extends ReadonlyArray<infer V>
        ? PathValue<V, Rest & Path<V>>
        : never
      : never
    : P extends keyof T
    ? T[P]
    : P extends `${number}`
    ? T extends ReadonlyArray<infer V>
      ? V
      : never
    : never
  : never;
