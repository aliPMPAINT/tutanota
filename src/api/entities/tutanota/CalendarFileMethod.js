// @flow

import {create, TypeRef} from "../../common/EntityFunctions"


export const CalendarFileMethodTypeRef: TypeRef<CalendarFileMethod> = new TypeRef("tutanota", "CalendarFileMethod")
export const _TypeModel: TypeModel = {
	"name": "CalendarFileMethod",
	"since": 42,
	"type": "AGGREGATED_TYPE",
	"id": 1114,
	"rootId": "CHR1dGFub3RhAARa",
	"versioned": false,
	"encrypted": false,
	"values": {
		"_id": {
			"name": "_id",
			"id": 1115,
			"since": 42,
			"type": "CustomId",
			"cardinality": "One",
			"final": true,
			"encrypted": false
		},
		"mailEncMethod": {
			"name": "mailEncMethod",
			"id": 1116,
			"since": 42,
			"type": "Bytes",
			"cardinality": "One",
			"final": true,
			"encrypted": false
		}
	},
	"associations": {
		"file": {
			"name": "file",
			"id": 1117,
			"since": 42,
			"type": "LIST_ELEMENT_ASSOCIATION",
			"cardinality": "One",
			"refType": "File",
			"final": true,
			"external": false
		}
	},
	"app": "tutanota",
	"version": "42"
}

export function createCalendarFileMethod(values?: $Shape<$Exact<CalendarFileMethod>>): CalendarFileMethod {
	return Object.assign(create(_TypeModel, CalendarFileMethodTypeRef), values)
}

export type CalendarFileMethod = {
	_type: TypeRef<CalendarFileMethod>;

	_id: Id;
	mailEncMethod: Uint8Array;

	file: IdTuple;
}