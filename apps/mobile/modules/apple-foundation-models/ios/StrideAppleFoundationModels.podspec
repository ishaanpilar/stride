Pod::Spec.new do |s|
  s.name = 'StrideAppleFoundationModels'
  s.version = '1.0.0'
  s.summary = 'Optional on-device Inbox clarification for Stride'
  s.description = 'Bridges Apple Foundation Models guided generation without store access.'
  s.homepage = 'https://github.com/ishaanpilar/stride'
  s.license = { type: 'AGPL-3.0-only' }
  s.author = { 'Stride' => 'dongdongli@dongdongli.com' }
  s.platform = :ios, '15.1'
  s.swift_version = '5.0'
  s.source = { git: 'https://github.com/ishaanpilar/stride.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Foundation'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = 'StrideAppleFoundationModelsModule.swift', 'AppleClarificationRequestRegistry.swift', 'ApplePccEvaluationEngine.swift'
end
