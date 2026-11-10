use crate::local_api::{self, LocalOperation};
use serde_json::{json, Map, Value};
use std::collections::HashSet;

const TASK_FIELDS: &[&str] = &[
    "title",
    "status",
    "projectId",
    "sectionId",
    "areaId",
    "dueDate",
    "startTime",
    "recurrence",
    "contexts",
    "tags",
    "description",
    "priority",
    "energyLevel",
    "assignedTo",
    "timeEstimate",
    "taskMode",
    "relativeStartOffset",
    "showFutureRecurrence",
    "pushCount",
    "checklist",
    "textDirection",
    "location",
    "isFocusedToday",
    "timeSpentMinutes",
    "suppressStrideReminders",
    "reminderPolicy",
    "repeatReminderMinutes",
    "dueReminderLeadMinutes",
    "startReminderLeadMinutes",
    "blockedByTaskIds",
    "reviewAt",
    "cancelledAt",
    "order",
    "boardOrder",
    "focusOrder",
    "attachments",
];
const PROJECT_FIELDS: &[&str] = &[
    "title",
    "color",
    "colorOverride",
    "status",
    "areaId",
    "isSequential",
];
const TOOL_NAMES: &[(&str, &str)] = &[
    ("stride_list_tasks", "List tasks with rich search, status, project, dates, focus, sorting and pagination. Availability views are unavailable."),
    ("stride_list_projects", "List live projects."),
    ("stride_get_project", "Get a project by ID."),
    ("stride_list_areas", "List live areas."),
    ("stride_add_task", "Add a task with an explicit title. Quick-add is unavailable."),
    ("stride_update_task", "Update a task. Attachment replacement and done/archived transitions are unavailable; use complete_task for completion."),
    ("stride_complete_task", "Mark a task done."),
    ("stride_archive_task", "Archive a task without generating a recurring follow-up; preserve existing completion history."),
    ("stride_delete_task", "Soft-delete a task."),
    ("stride_get_task", "Get a task by ID."),
    ("stride_restore_task", "Restore a soft-deleted task."),
    ("stride_add_project", "Add a project with title, color, status, areaId and isSequential."),
    ("stride_update_project", "Update a project with title, color, status, areaId and isSequential. Setting isSequential true makes a Per section project Sequential; perSectionFlow and section flow choices are managed by the apps and are read-only here."),
    ("stride_delete_project", "Soft-delete a project."),
];

pub(crate) fn tools() -> Vec<Value> {
    TOOL_NAMES.iter().map(|(name, description)| {
        let fields: Vec<&str> = match *name {
            "stride_list_tasks" => crate::local_query::TASK_QUERY_FIELDS.to_vec(),
            "stride_add_task" => TASK_FIELDS.to_vec(),
            "stride_update_task" => std::iter::once("id").chain(TASK_FIELDS.iter().copied().filter(|field| *field != "attachments")).collect(),
            "stride_add_project" => PROJECT_FIELDS.to_vec(),
            "stride_update_project" => std::iter::once("id").chain(PROJECT_FIELDS.iter().copied()).collect(),
            "stride_get_task" | "stride_get_project" => vec!["id", "includeDeleted"],
            "stride_list_projects" | "stride_list_areas" => vec![],
            _ => vec!["id"],
        };
        let mut properties = Map::new();
        for field in fields {
            let mut schema = field_schema(field, name.contains("project"));
            if field == "status" && *name != "stride_list_tasks" && !name.contains("project") {
                schema["enum"].as_array_mut().unwrap().retain(|status| status != "all" && (*name != "stride_update_task" || (status != "done" && status != "archived")));
            }
            if (name.contains("project") && matches!(field, "areaId" | "colorOverride")) || (name.starts_with("stride_update_") && !matches!(field, "id" | "title" | "status" | "color" | "colorOverride" | "isSequential" | "showFutureRecurrence" | "isFocusedToday" | "suppressStrideReminders")) {
                schema = json!({"anyOf":[schema, {"type":"null"}]});
            }
            properties.insert(field.to_string(), schema);
        }
        let required = if name.starts_with("stride_add_") { vec!["title"] }
            else if name.starts_with("stride_list_") { vec![] } else { vec!["id"] };
        json!({"name": name, "description": description,
            "inputSchema": {"type":"object", "properties":properties, "required":required, "additionalProperties":false}})
    }).collect()
}

fn field_schema(field: &str, project: bool) -> Value {
    match field {
        "id" => json!({"type":"string", "minLength":1}),
        "title" => json!({"type":"string", "minLength":1, "maxLength":500}),
        "status" if project => json!({"enum":["active","someday","waiting","archived"]}),
        "status" => {
            json!({"enum":["all","inbox","next","waiting","someday","reference","done","archived"]})
        }
        "priority" => json!({"enum":["low","medium","high","urgent"]}),
        "energyLevel" => json!({"enum":["low","medium","high"]}),
        "taskMode" => json!({"enum":["task","list"]}),
        "reminderPolicy" => json!({"enum":["inherit","send","skip"]}),
        "textDirection" => json!({"enum":["auto","ltr","rtl"]}),
        "sortBy" => json!({"enum":["updatedAt","createdAt","dueDate","title","priority"]}),
        "sortOrder" => json!({"enum":["asc","desc"]}),
        "contexts" | "tags" => {
            json!({"type":"array", "items":{"type":"string", "minLength":1, "maxLength":500}})
        }
        "blockedByTaskIds" => {
            json!({"type":"array", "maxItems":50, "items":{"type":"string", "minLength":1, "maxLength":500}, "description":"IDs of tasks that must finish before this one can start."})
        }
        "isSequential"
        | "isFocusedToday"
        | "includeDeleted"
        | "showFutureRecurrence"
        | "suppressStrideReminders" => json!({"type":"boolean"}),
        "limit" => json!({"type":"integer", "minimum":1, "maximum":1000}),
        "offset" => json!({"type":"integer", "minimum":0, "maximum":100000}),
        "order" | "boardOrder" | "focusOrder" => json!({"type":"integer"}),
        "pushCount" | "timeSpentMinutes" => json!({"type":"integer", "minimum":0}),
        "dueReminderLeadMinutes" => json!({"type":"integer","minimum":0,"maximum":10080}),
        "startReminderLeadMinutes" => json!({"type":"integer","enum":[0,5,15,30,60]}),
        "repeatReminderMinutes" => json!({"enum":[0,5,10,15,30,60]}),
        "relativeStartOffset" => {
            json!({"type":"object", "properties":{"amount":{"type":"number"}, "unit":{"enum":["minute","hour","day","week"]}}, "required":["amount","unit"], "additionalProperties":false})
        }
        "recurrence" => json!({"anyOf":[
            {"type":"string", "maxLength":2000, "description":"RFC 5545 RRULE containing FREQ (case-insensitive)"},
            {"type":"object", "properties":{
                "rule":{"enum":["daily","weekly","monthly","yearly"]},
                "seriesId":{"type":"string","minLength":1,"maxLength":500},
                "strategy":{"enum":["strict","fluid"]},
                "byDay":{"type":"array","items":{"type":"string","pattern":"^(?:[1-4]|-1)?(?:MO|TU|WE|TH|FR|SA|SU)$"}},
                "byMonthDay":{"type":"array","maxItems":31,"items":{"anyOf":[{"type":"integer","minimum":1,"maximum":31},{"const":-1}]}},
                "weekStart":{"enum":["MO","TU","WE","TH","FR","SA","SU"]},
                "count":{"type":"integer","minimum":1},
                "until":{"type":"string","description":"ISO date or datetime"},
                "completedOccurrences":{"type":"integer","minimum":0},
                "anchorDay":{"type":"integer","minimum":1,"maximum":31},
                "startAnchorDay":{"type":"integer","minimum":1,"maximum":31},
                "dueAnchorDay":{"type":"integer","minimum":1,"maximum":31},
                "reviewAnchorDay":{"type":"integer","minimum":1,"maximum":31},
                "rrule":{"type":"string","maxLength":2000}
            }, "required":["rule"], "additionalProperties":false}
        ]}),
        "checklist" => {
            json!({"type":"array", "items":{"type":"object", "properties":{"id":{"type":"string", "minLength":1}, "title":{"type":"string", "minLength":1}, "isCompleted":{"type":"boolean", "default":false}}, "required":["id","title"], "additionalProperties":false}})
        }
        "attachments" => {
            json!({"type":"array", "maxItems":50, "items":{"type":"object", "properties":{"id":{"type":"string","minLength":1,"maxLength":128},"kind":{"const":"link"}, "title":{"type":"string","maxLength":200}, "uri":{"type":"string","minLength":1,"maxLength":2048}}, "required":["uri"], "additionalProperties":false}})
        }
        "search" => json!({"type":"string", "maxLength":512}),
        "dueDate" | "startTime" | "reviewAt" | "dueDateFrom" | "dueDateTo" | "cancelledAt" => {
            json!({"type":"string", "description":"ISO date (YYYY-MM-DD) or datetime with timezone; cancelledAt requires a datetime"})
        }
        _ => json!({"type":"string"}),
    }
}

pub(crate) fn operation(name: &str, input: &Map<String, Value>) -> Result<LocalOperation, String> {
    let invalid = || "Invalid tool arguments".to_string();
    let only = |allowed: &[&str]| {
        if input.keys().all(|field| allowed.contains(&field.as_str())) {
            Ok(())
        } else {
            Err(invalid())
        }
    };
    let id = || {
        input
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .map(str::to_string)
            .ok_or_else(invalid)
    };
    let get = || {
        only(&["id", "includeDeleted"])?;
        if input
            .get("includeDeleted")
            .is_some_and(|value| !value.is_boolean())
        {
            return Err(invalid());
        }
        id()
    };
    Ok(match name {
        "stride_list_tasks" => {
            crate::local_query::validate_query(input)?;
            LocalOperation::QueryTasks(input.clone())
        }
        "stride_list_projects" => {
            only(&[])?;
            LocalOperation::ListProjects
        }
        "stride_list_areas" => {
            only(&[])?;
            LocalOperation::ListAreas
        }
        "stride_get_task" => LocalOperation::GetTask(get()?),
        "stride_get_project" => LocalOperation::GetProject(get()?),
        "stride_add_task" | "stride_update_task" => {
            let creating = name == "stride_add_task";
            if creating && input.values().any(Value::is_null) {
                return Err(invalid());
            }
            if input.keys().any(|field| {
                !TASK_FIELDS.contains(&field.as_str()) && !(field == "id" && !creating)
            }) || (!creating && input.contains_key("attachments"))
            {
                return Err(invalid());
            }
            let mut props = input.clone();
            let entity_id = if creating { None } else { Some(id()?) };
            props.remove("id");
            if let Some(recurrence) = props.get_mut("recurrence") {
                *recurrence = local_api::normalize_mcp_recurrence(recurrence)?;
            }
            for field in ["tags", "contexts"] {
                if props.get(field).is_some_and(Value::is_null) && !creating {
                    props.insert(field.into(), json!([]));
                }
            }
            if let Some(attachments) = props.get_mut("attachments") {
                *attachments = normalize_links(attachments)?;
            }
            if creating
                && !props
                    .get("title")
                    .and_then(Value::as_str)
                    .is_some_and(|title| !title.trim().is_empty())
            {
                return Err(invalid());
            }
            if !creating
                && props
                    .get("status")
                    .and_then(Value::as_str)
                    .is_some_and(|status| matches!(status, "done" | "archived"))
            {
                return Err(invalid());
            }
            if props.get("cancelledAt").is_some_and(Value::is_string)
                && props
                    .get("status")
                    .is_some_and(|status| status.as_str() != Some("archived"))
            {
                return Err(invalid());
            }
            if let Some(items) = props.get_mut("checklist").and_then(Value::as_array_mut) {
                for item in items {
                    let object = item.as_object_mut().ok_or_else(invalid)?;
                    if object
                        .keys()
                        .any(|key| !matches!(key.as_str(), "id" | "title" | "isCompleted"))
                    {
                        return Err(invalid());
                    }
                    for field in ["id", "title"] {
                        let value = object
                            .get(field)
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .ok_or_else(invalid)?
                            .to_string();
                        object.insert(field.into(), Value::String(value));
                    }
                }
            }
            local_api::sanitize_task_patch_map(&mut props)?;
            if creating {
                let title = props.remove("title").ok_or_else(invalid)?;
                LocalOperation::CreateTask(
                    json!({"title":title,"props":props})
                        .as_object()
                        .unwrap()
                        .clone(),
                )
            } else {
                LocalOperation::PatchTask {
                    id: entity_id.unwrap(),
                    body: props,
                }
            }
        }
        "stride_add_project" | "stride_update_project" => {
            let creating = name == "stride_add_project";
            if input.keys().any(|field| {
                !PROJECT_FIELDS.contains(&field.as_str()) && !(field == "id" && !creating)
            }) {
                return Err(invalid());
            }
            let mut props = input.clone();
            let entity_id = if creating { None } else { Some(id()?) };
            props.remove("id");
            let mut props = local_api::sanitize_project_fields(&props, true)?;
            if creating {
                let title = props.remove("title").ok_or_else(invalid)?;
                LocalOperation::CreateProject(
                    json!({"title":title,"props":props})
                        .as_object()
                        .unwrap()
                        .clone(),
                )
            } else {
                LocalOperation::PatchProject {
                    id: entity_id.unwrap(),
                    body: props,
                }
            }
        }
        "stride_complete_task" | "stride_archive_task" | "stride_restore_task" => {
            only(&["id"])?;
            LocalOperation::TaskAction {
                id: id()?,
                action: if name == "stride_complete_task" {
                    "complete"
                } else if name == "stride_archive_task" {
                    "archive"
                } else {
                    "restore"
                }
                .into(),
            }
        }
        "stride_delete_task" => {
            only(&["id"])?;
            LocalOperation::DeleteTask(id()?)
        }
        "stride_delete_project" => {
            only(&["id"])?;
            LocalOperation::ProjectLifecycle {
                id: id()?,
                restore: false,
            }
        }
        _ => return Err("Unsupported tool".into()),
    })
}

fn normalize_links(input: &Value) -> Result<Value, String> {
    let invalid = || "Invalid task link attachments".to_string();
    let items = input
        .as_array()
        .filter(|items| items.len() <= 50)
        .ok_or_else(invalid)?;
    let mut ids = HashSet::new();
    let mut uris = HashSet::new();
    let mut links = Vec::new();
    for item in items {
        let item = item.as_object().ok_or_else(invalid)?;
        if item
            .keys()
            .any(|key| !matches!(key.as_str(), "id" | "kind" | "title" | "uri"))
            || item
                .get("kind")
                .is_some_and(|kind| kind.as_str() != Some("link"))
        {
            return Err(invalid());
        }
        let uri = item
            .get("uri")
            .and_then(Value::as_str)
            .filter(|uri| uri.encode_utf16().count() <= 2048)
            .map(str::trim)
            .filter(|uri| !uri.is_empty())
            .ok_or_else(invalid)?;
        let network_path = |path: &str| path.replace('\\', "/").starts_with("//");
        if network_path(uri) {
            return Err(invalid());
        }
        if uri.to_ascii_lowercase().starts_with("file:") {
            let normalized = uri[5..].replace('\\', "/");
            if let Some(authority) = normalized.strip_prefix("//") {
                let (host, path) = authority.split_once('/').unwrap_or((authority, ""));
                if (!host.is_empty() && !host.eq_ignore_ascii_case("localhost"))
                    || path.starts_with('/')
                {
                    return Err(invalid());
                }
            }
            if let Ok(url) = reqwest::Url::parse(uri) {
                if local_api::percent_decode(url.path()).is_some_and(|path| network_path(&path)) {
                    return Err(invalid());
                }
            }
        }
        let id = match item.get("id") {
            None => None,
            Some(value) => Some(
                value
                    .as_str()
                    .filter(|id| !id.is_empty() && id.encode_utf16().count() <= 128)
                    .ok_or_else(invalid)?
                    .trim(),
            ),
        }
        .filter(|id| !id.is_empty());
        if let Some(id) = id {
            if !ids.insert(id) {
                return Err(invalid());
            }
        }
        if id.is_none() && !uris.insert(uri) {
            continue;
        }
        uris.insert(uri);
        let title = match item.get("title") {
            None => None,
            Some(value) => Some(
                value
                    .as_str()
                    .filter(|title| title.encode_utf16().count() <= 200)
                    .ok_or_else(invalid)?
                    .trim(),
            ),
        }
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| {
            let trimmed = uri.trim_end_matches(['/', '\\']);
            let segment = trimmed
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or("")
                .split(['?', '#'])
                .next()
                .unwrap_or("");
            if segment.is_empty() {
                trimmed
            } else {
                segment
            }
        });
        let now = local_api::now_iso();
        links.push(json!({"id":id.map(str::to_string).unwrap_or_else(local_api::generate_uuid_v4), "kind":"link", "title":title, "uri":uri, "createdAt":now, "updatedAt":now}));
    }
    Ok(Value::Array(links))
}

pub(crate) fn tool_result(
    name: &str,
    input: &Map<String, Value>,
    mut body: Value,
) -> Result<Value, ()> {
    if matches!(name, "stride_get_task" | "stride_get_project")
        && input.get("includeDeleted").and_then(Value::as_bool) != Some(true)
    {
        let kind = if name == "stride_get_task" {
            "task"
        } else {
            "project"
        };
        if body[kind]
            .get("deletedAt")
            .and_then(Value::as_str)
            .is_some_and(|s| !s.is_empty())
        {
            return Err(());
        }
    }
    let add_order = |project: &mut Value| {
        if let Some(project) = project.as_object_mut() {
            if !project.contains_key("orderNum") {
                if let Some(order) = project.get("order").cloned() {
                    project.insert("orderNum".into(), order);
                }
            }
        }
    };
    if name == "stride_list_projects" {
        if let Some(projects) = body["projects"].as_array_mut() {
            for project in projects {
                add_order(project);
            }
        }
    }
    if matches!(
        name,
        "stride_get_project"
            | "stride_add_project"
            | "stride_update_project"
            | "stride_delete_project"
    ) {
        add_order(&mut body["project"]);
    }
    if name == "stride_list_areas" {
        if let Some(areas) = body["areas"].as_array_mut() {
            areas.sort_by(|a, b| {
                a["order"]
                    .as_f64()
                    .unwrap_or(0.0)
                    .total_cmp(&b["order"].as_f64().unwrap_or(0.0))
                    .then_with(|| {
                        b["updatedAt"]
                            .as_str()
                            .unwrap_or("")
                            .cmp(a["updatedAt"].as_str().unwrap_or(""))
                    })
            });
        }
    }
    Ok(body)
}

pub(crate) fn error_response(code: &str, message: &str) -> Value {
    json!({"isError":true, "content":[{"type":"text","text":serde_json::to_string(&json!({"error":message,"code":code})).unwrap()}]})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_tool_schemas_expose_per_operation_statuses_and_typed_recurrence() {
        let tools = tools();
        for (name, expected) in [
            (
                "stride_list_tasks",
                json!([
                    "all",
                    "inbox",
                    "next",
                    "waiting",
                    "someday",
                    "reference",
                    "done",
                    "archived"
                ]),
            ),
            (
                "stride_add_task",
                json!([
                    "inbox",
                    "next",
                    "waiting",
                    "someday",
                    "reference",
                    "done",
                    "archived"
                ]),
            ),
            (
                "stride_update_task",
                json!(["inbox", "next", "waiting", "someday", "reference"]),
            ),
        ] {
            let tool = tools.iter().find(|tool| tool["name"] == name).unwrap();
            assert_eq!(
                tool["inputSchema"]["properties"]["status"]["enum"], expected,
                "{name}"
            );
        }
        let recurrence = field_schema("recurrence", false);
        let object = &recurrence["anyOf"][1];
        assert_eq!(object["required"], json!(["rule"]));
        assert_eq!(object["additionalProperties"], false);
        assert_eq!(object["properties"].as_object().unwrap().len(), 14);
        assert_eq!(
            object["properties"]["rule"]["enum"],
            json!(["daily", "weekly", "monthly", "yearly"])
        );
        assert_eq!(object["properties"]["byDay"]["type"], "array");
        assert_eq!(object["properties"]["count"]["type"], "integer");
        assert_eq!(object["properties"]["rrule"]["type"], "string");
        let input =
            json!({"title":"Recurring","recurrence":{"rule":"weekly","byDay":["MO"],"count":2}});
        assert!(operation("stride_add_task", input.as_object().unwrap()).is_ok());
        for invalid in [
            json!({"byDay":["MO"]}),
            json!({"rule":"weekly","byDay":"MO"}),
            json!({"rule":"weekly","count":"2"}),
            json!({"rule":"weekly","extra":true}),
        ] {
            let input = json!({"title":"Task","recurrence":invalid});
            assert!(operation("stride_add_task", input.as_object().unwrap()).is_err());
        }
    }

    #[test]
    fn mcp_task_create_rejects_null_while_nullable_updates_normalize_clears() {
        for field in TASK_FIELDS {
            let mut input = json!({"title":"Task"}).as_object().unwrap().clone();
            input.insert((*field).into(), Value::Null);
            assert!(
                operation("stride_add_task", &input).is_err(),
                "create {field}"
            );
            if *field == "attachments" {
                continue;
            }
            let input = json!({"id":"task",*field:Value::Null});
            let result = operation("stride_update_task", input.as_object().unwrap());
            if matches!(
                *field,
                "title"
                    | "status"
                    | "showFutureRecurrence"
                    | "isFocusedToday"
                    | "suppressStrideReminders"
            ) {
                assert!(result.is_err(), "update {field}");
            } else {
                let LocalOperation::PatchTask { body, .. } =
                    result.unwrap_or_else(|_| panic!("update {field}"))
                else {
                    panic!()
                };
                assert_eq!(
                    body[*field],
                    if matches!(*field, "tags" | "contexts") {
                        json!([])
                    } else {
                        Value::Null
                    }
                );
            }
        }
        assert!(operation(
            "stride_add_project",
            json!({"title":"P","areaId":null}).as_object().unwrap()
        )
        .is_ok());
        assert!(operation(
            "stride_add_project",
            json!({"title":"P","color":null}).as_object().unwrap()
        )
        .is_err());
        for unsupported in ["all", "done", "archived"] {
            assert!(operation(
                "stride_update_task",
                json!({"id":"task","status":unsupported})
                    .as_object()
                    .unwrap()
            )
            .is_err());
        }
    }
}
