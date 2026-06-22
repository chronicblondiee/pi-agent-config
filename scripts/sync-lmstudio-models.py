#!/usr/bin/env python3
import json
import os
import urllib.request
import urllib.error

LM_STUDIO_URL = "http://localhost:1234/v1/models"
PI_CONFIG_PATH = os.path.expanduser("~/projects/pi-agent-config/pi-config/models.json")
LIVE_CONFIG_PATH = os.path.expanduser("~/.pi/agent/models.json")

def get_lm_studio_models():
    try:
        req = urllib.request.Request(LM_STUDIO_URL)
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode('utf-8'))
            models = [model['id'] for model in data.get('data', [])]
            return models
    except urllib.error.URLError as e:
        print(f"Failed to connect to LM Studio: {e}")
        return []

def get_model_config(model_id):
    # Base defaults
    config = {
        "id": model_id,
        "input": ["text", "image"],
        "contextWindow": 8192,
        "reasoning": False
    }

    # Heuristics based on name
    lower_id = model_id.lower()
    if "qwen" in lower_id:
        config["contextWindow"] = 65536
        config["reasoning"] = True
        config["compat"] = { "thinkingFormat": "qwen" }
        if "35b" in lower_id:
            config["contextWindow"] = 24576
    elif "gemma" in lower_id:
        config["contextWindow"] = 65536
        config["reasoning"] = True
        config["compat"] = { "thinkingFormat": "qwen-chat-template" }
        if "31b" in lower_id:
            config["contextWindow"] = 24576
    elif "embed" in lower_id:
        # Embedding models probably shouldn't be in the pi config for text completion
        return None

    return config

def clean_incorrect_models(models_list):
    """
    Remove known incorrect models such as `qwen3.6-27b` if we are going to add the correct `qwen/qwen3.6-27b`.
    For now, let's just specifically remove `qwen3.6-27b` as it's a known bad entry.
    """
    return [m for m in models_list if m.get("id") != "qwen3.6-27b"]

def update_config(config_path, active_models):
    if not os.path.exists(config_path):
        print(f"Config file not found: {config_path}")
        return

    with open(config_path, 'r') as f:
        try:
            config_data = json.load(f)
        except json.JSONDecodeError:
            print(f"Invalid JSON in {config_path}")
            return

    if "providers" not in config_data or "lmstudio" not in config_data["providers"]:
        print(f"Missing lmstudio provider in {config_path}")
        return

    lmstudio_models = config_data["providers"]["lmstudio"].get("models", [])
    
    # Remove bad models
    original_len = len(lmstudio_models)
    lmstudio_models = clean_incorrect_models(lmstudio_models)
    updated = (len(lmstudio_models) != original_len)
    
    existing_ids = {m.get("id") for m in lmstudio_models}
    
    for model_id in active_models:
        if model_id not in existing_ids:
            model_config = get_model_config(model_id)
            if model_config is not None:
                print(f"Adding new model {model_id} to {config_path}")
                lmstudio_models.append(model_config)
                existing_ids.add(model_id)
                updated = True

    if updated:
        config_data["providers"]["lmstudio"]["models"] = lmstudio_models
        with open(config_path, 'w') as f:
            json.dump(config_data, f, indent=2)
        print(f"Successfully updated {config_path}")
    else:
        print(f"No new models to add for {config_path}")

def main():
    print("Fetching models from LM Studio...")
    active_models = get_lm_studio_models()
    
    if not active_models:
        print("No active models found in LM Studio or LM Studio is not running.")
        return
        
    print(f"Found active models: {', '.join(active_models)}")
    
    update_config(PI_CONFIG_PATH, active_models)
    update_config(LIVE_CONFIG_PATH, active_models)

if __name__ == "__main__":
    main()
