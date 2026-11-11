import { Schema } from "effect"

/**
 * Single closed SQLSTATE vocabulary for native connection and statement errors.
 * This leaf owns no driver, Drizzle graph, relation identity or runtime access.
 * Unlisted vendor/client conditions remain unclassified, never arbitrary codes.
 * @source https://www.postgresql.org/docs/18/errcodes-appendix.html
 * @verified 2026-09-09
 * 42P17 verified 2026-09-16 for generated-expression immutability admission.
 */
export const SqlStateSchema = Schema.Literals([
	"08000", // connection_exception
	"08003", // connection_does_not_exist
	"08006", // connection_failure
	"08007", // transaction_resolution_unknown
	"08P01", // protocol_violation
	"0A000", // feature_not_supported
	"22001", // string_data_right_truncation
	"22003", // numeric_value_out_of_range
	"22012", // division_by_zero
	"22021", // character_not_in_repertoire
	"22023", // invalid_parameter_value
	"22P02", // invalid_text_representation
	"23502", // not_null_violation
	"23503", // foreign_key_violation
	"23505", // unique_violation
	"23514", // check_violation
	"23P01", // exclusion_violation
	"25006", // read_only_sql_transaction
	"25P02", // in_failed_sql_transaction
	"28000", // invalid_authorization_specification
	"28P01", // invalid_password
	"2BP01", // dependent_objects_still_exist
	"3D000", // invalid_catalog_name
	"3F000", // invalid_schema_name
	"40001", // serialization_failure
	"40P01", // deadlock_detected
	"42501", // insufficient_privilege
	"42601", // syntax_error
	"42701", // duplicate_column
	"42702", // ambiguous_column
	"42703", // undefined_column
	"42704", // undefined_object
	"42710", // duplicate_object
	"42803", // grouping_error
	"42804", // datatype_mismatch
	"42809", // wrong_object_type
	"42830", // invalid_foreign_key
	"42846", // cannot_coerce
	"42883", // undefined_function
	"42P01", // undefined_table
	"42P02", // undefined_parameter
	"42P07", // duplicate_table
	"42P08", // ambiguous_parameter
	"42P09", // ambiguous_alias
	"42P10", // invalid_column_reference
	"42P17", // invalid_object_definition (including non-immutable generation expressions)
	"42P18", // indeterminate_datatype
	"42P21", // collation_mismatch
	"42P22", // indeterminate_collation
	"53000", // insufficient_resources
	"53100", // disk_full
	"53200", // out_of_memory
	"53300", // too_many_connections
	"53400", // configuration_limit_exceeded
	"54000", // program_limit_exceeded
	"54001", // statement_too_complex
	"54011", // too_many_columns
	"54023", // too_many_arguments
	"55000", // object_not_in_prerequisite_state
	"55P03", // lock_not_available
	"57014", // query_canceled
	"57P01", // admin_shutdown
	"57P02", // crash_shutdown
	"57P03", // cannot_connect_now
	"58030", // io_error
	"P0001", // raise_exception (owner migration preservation guards)
	"XX000", // internal_error
	"XX001", // data_corrupted
	"XX002" // index_corrupted
])
export type SqlState = typeof SqlStateSchema.Type

/** The server never reported whether the transaction resolved. */
const ReconcileSqlStateSchema = Schema.Literals(["08007"] as const satisfies readonly SqlState[])
type ReconcileSqlState = typeof ReconcileSqlStateSchema.Type

/**
 * Connection loss, protocol breakdown, contention, cancellation, shutdown and
 * resource exhaustion. 08P01 and resource class 53 retry rather than refuse;
 * 08007 reconciles rather than retries.
 */
const TransientSqlStateSchema = Schema.Literals([
	"08000",
	"08003",
	"08006",
	"08P01",
	"40001",
	"40P01",
	"53000",
	"53100",
	"53200",
	"53300",
	"53400",
	"55P03",
	"57014",
	"57P01",
	"57P02",
	"57P03"
] as const satisfies readonly SqlState[])
export type TransientSqlState = typeof TransientSqlStateSchema.Type

/** Every listed condition outside the reconcile and transient partitions. */
export type PermanentSqlState = Exclude<SqlState, ReconcileSqlState | TransientSqlState>

/**
 * How a native condition settles, carrying the code narrowed to its partition so
 * a host can name every member of one partition totally: `transient` work may
 * run again unchanged, `permanent` work is refused until something outside the
 * retry changes, and `reconcile` means the server may have finished the work
 * without saying so.
 */
type SqlStateStanding =
	| Readonly<{ kind: "reconcile"; code: ReconcileSqlState }>
	| Readonly<{ kind: "transient"; code: TransientSqlState }>
	| Readonly<{ kind: "permanent"; code: PermanentSqlState }>

/** The one partition every host derives its remedy from; unlisted conditions are permanent. */
export const sqlStateStandingOf = (code: SqlState): SqlStateStanding =>
	Schema.is(ReconcileSqlStateSchema)(code)
		? { kind: "reconcile", code }
		: Schema.is(TransientSqlStateSchema)(code)
			? { kind: "transient", code }
			: { kind: "permanent", code }

export const sqlStateDispositionOf = (code: SqlState): SqlStateStanding["kind"] =>
	sqlStateStandingOf(code).kind
